import { Chess } from 'chess.js';
import {
  MATE_DISPLAY_THRESHOLD,
  MATE_VALUE,
  PIECE_VALUES,
  START_FEN,
} from './constants.js';

const SAN_RE = /^(O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?$/;
const FIGURINE_TO_LETTER = {
  '♔': 'K',
  '♚': 'K',
  '♕': 'Q',
  '♛': 'Q',
  '♖': 'R',
  '♜': 'R',
  '♗': 'B',
  '♝': 'B',
  '♘': 'N',
  '♞': 'N',
  '♙': '',
  '♟': '',
};

export function createChess(fen = START_FEN) {
  return new Chess(fen);
}

/**
 * Turns a raw move-list label into SAN that chess.js understands.
 * Returns null for list decorations, move numbers and other noise.
 */
export function normalizeSan(raw) {
  if (raw === null || raw === undefined) return null;
  let text = String(raw)
    .replace(/\u00a0/g, ' ')
    .replace(/…/g, '...')
    .trim();
  if (!text) return null;

  text = text
    .replace(/^\s*\d+\s*\.(?:\s*\.\.)?\s*/, '')
    .replace(/^\.\.\.\s*/, '')
    .replace(/[♔-♟]/g, (char) => FIGURINE_TO_LETTER[char] ?? '')
    .replace(/\s*e\.?\s*p\.?\s*$/i, '')
    .replace(/\$\d+/g, '')
    .replace(/[!?]+/g, '')
    .replace(/[–—−]/g, '-')
    .replace(/\b0-0(?:-0)?\b/g, (castle) => castle.replace(/0/g, 'O'))
    .trim();

  if (!text) return null;
  if (SAN_RE.test(text)) return text;

  // Move-list nodes sometimes contain the evaluation after the move.
  // Accept the first token that is a complete, valid SAN.
  for (const token of text.split(/[\s,;]+/)) {
    const candidate = token.replace(/[!?]+/g, '').replace(/[–—−]/g, '-');
    if (SAN_RE.test(candidate)) return candidate;
  }
  return null;
}

export function moveToUci(move) {
  if (!move) return null;
  if (move.lan) return move.lan;
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

export function applyUci(chess, uci) {
  if (!uci || uci.length < 4) return null;
  try {
    return chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4].toLowerCase() : undefined,
    });
  } catch {
    return null;
  }
}

export function uciToSan(fen, uci) {
  const chess = new Chess(fen);
  const move = applyUci(chess, uci);
  return move ? move.san : null;
}

export function pvToSan(fen, pv = [], maxPlies = 10) {
  const chess = new Chess(fen);
  const sans = [];
  for (const uci of pv.slice(0, maxPlies)) {
    const move = applyUci(chess, uci);
    if (!move) break;
    sans.push(move.san);
  }
  return sans;
}

export function sanListToPgn(sans, options = {}) {
  const startFen = options.startFen || START_FEN;
  const result = options.result || '*';
  const headers = {
    Event: options.event || 'WhyChess',
    Site: options.site || 'WhyChess',
    Date: options.date || '????.??.??',
    White: options.white || 'Белые',
    Black: options.black || 'Чёрные',
    Result: result,
    ...options.headers,
  };

  if (startFen !== START_FEN) {
    headers.SetUp = '1';
    headers.FEN = startFen;
  }

  const headerText = Object.entries(headers)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `[${key} "${escapePgnHeader(value)}"]`)
    .join('\n');

  const placement = parseFenPlacement(startFen);
  let turn = placement.turn;
  let moveNumber = placement.moveNumber;
  let firstMove = true;
  const tokens = [];

  for (const san of sans) {
    if (turn === 'w') {
      tokens.push(`${moveNumber}. ${san}`);
    } else if (firstMove) {
      tokens.push(`${moveNumber}... ${san}`);
    } else {
      tokens.push(san);
    }
    if (turn === 'b') moveNumber += 1;
    turn = turn === 'w' ? 'b' : 'w';
    firstMove = false;
  }

  return `${headerText}\n\n${tokens.join(' ')}${tokens.length ? ' ' : ''}${result}\n`;
}

function escapePgnHeader(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

function parseFenPlacement(fen) {
  const fields = String(fen).trim().split(/\s+/);
  const turn = fields[1] === 'b' ? 'b' : 'w';
  const moveNumber = Number.parseInt(fields[5] || '1', 10);
  return { turn, moveNumber: Number.isFinite(moveNumber) && moveNumber > 0 ? moveNumber : 1 };
}

/**
 * Parses and validates a PGN. Side variations are ignored by chess.js, while
 * comments, clock annotations and NAGs are accepted.
 */
export function parsePgn(pgn, options = {}) {
  const text = String(pgn ?? '').replace(/^\uFEFF/, '').trim();
  if (!text) {
    throw makePgnError('PGN пустой. Вставьте текст партии.');
  }

  const chess = new Chess();
  try {
    chess.loadPgn(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw makePgnError(`Не удалось прочитать PGN. ${detail}`, 'INVALID_PGN', error);
  }

  const headers = chess.getHeaders();
  const variant = headers.Variant || 'Standard';
  if (!/^(standard|from position)$/i.test(variant)) {
    throw makePgnError(
      `Поддерживаются только обычные шахматы. В PGN указан вариант «${variant}».`,
      'UNSUPPORTED_VARIANT',
    );
  }

  const moves = chess.history({ verbose: true });
  if (moves.length === 0) {
    throw makePgnError('В PGN не найдено ни одного хода.', 'EMPTY_PGN');
  }

  const limit = options.limit && options.limit > 0 ? Math.min(options.limit, moves.length) : moves.length;
  const selectedMoves = moves.slice(0, limit);
  const initialFen = moves[0].before;
  const result = headers.Result && headers.Result !== '?' ? headers.Result : '*';

  return {
    moves: selectedMoves,
    allMoves: moves,
    initialFen,
    finalFen: selectedMoves[selectedMoves.length - 1].after,
    headers,
    result,
    white: headers.White || 'Белые',
    black: headers.Black || 'Чёрные',
    variant,
    truncated: selectedMoves.length < moves.length,
    totalMoves: moves.length,
  };
}

function makePgnError(message, code = 'INVALID_PGN', cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

export function scoreFromCp(cp) {
  return { type: 'cp', value: Math.round(cp) };
}

export function scoreFromMate(mate) {
  return { type: 'mate', value: mate };
}

export function scoreToCp(score) {
  if (!score) return 0;
  if (score.type === 'cp') return Number(score.value) || 0;
  const mate = Number(score.value);
  if (!Number.isFinite(mate)) return 0;
  if (mate > 0) return MATE_VALUE - mate * 10;
  if (mate < 0) return -MATE_VALUE + mate * 10;
  return -MATE_VALUE;
}

/** Converts an engine score (side to move) into a White-perspective score. */
export function scoreToWhite(score, turn) {
  if (!score) return { type: 'cp', value: 0 };
  if (score.type === 'mate') {
    return { type: 'mate', value: turn === 'w' ? score.value : -score.value };
  }
  const value = Number(score.value) || 0;
  return { type: 'cp', value: turn === 'w' ? value : -value };
}

/** Converts an engine score into centipawns from the mover's point of view. */
export function scoreForMover(score, turn, moverColor) {
  const cp = scoreToCp(score);
  return turn === moverColor ? cp : -cp;
}

export function formatEvaluation(score, turn, options = {}) {
  const white = scoreToWhite(score, turn);
  if (white.type === 'mate') {
    const mate = white.value;
    if (mate > 0) return `мат в ${mate}`;
    if (mate < 0) return `мат в ${Math.abs(mate)} за чёрных`;
    return 'мат';
  }
  const cp = white.value;
  if (Math.abs(cp) >= MATE_DISPLAY_THRESHOLD) {
    return cp > 0 ? 'мат за белых' : 'мат за чёрных';
  }
  const pawns = Math.abs(cp) / 100;
  const number = pawns.toFixed(2).replace('.', ',');
  if (pawns < 0.005) return '0,00';
  return `${cp > 0 ? '+' : '−'}${number}`;
}

export function evaluationSummary(score, turn) {
  const white = scoreToWhite(score, turn);
  if (white.type === 'mate') {
    if (white.value > 0) return `белые форсируют мат в ${white.value}`;
    if (white.value < 0) return `чёрные форсируют мат в ${Math.abs(white.value)}`;
    return 'на доске мат';
  }
  const cp = white.value;
  const abs = Math.abs(cp);
  const side = cp > 0 ? 'белых' : 'чёрных';
  if (abs >= MATE_DISPLAY_THRESHOLD) return cp > 0 ? 'белые дают мат' : 'чёрные дают мат';
  if (abs <= 30) return 'позиция примерно равная';
  if (abs <= 80) return `небольшое преимущество ${side}`;
  if (abs <= 180) return `заметное преимущество ${side}`;
  if (abs <= 400) return `большое преимущество ${side}`;
  return `решающее преимущество ${side}`;
}

export function formatLoss(cp) {
  if (!Number.isFinite(cp) || cp <= 0) return 'без потери';
  if (cp >= MATE_DISPLAY_THRESHOLD) return 'потеря приводит к мату';
  const pawns = cp / 100;
  return `${pawns.toFixed(2).replace('.', ',')} пешки`;
}

export function materialScore(chess, color) {
  return chess
    .board()
    .flat()
    .filter((piece) => piece && piece.color === color)
    .reduce((sum, piece) => sum + (PIECE_VALUES[piece.type] || 0), 0);
}

export function materialDiff(chess) {
  return materialScore(chess, 'w') - materialScore(chess, 'b');
}

export function terminalResult(fen) {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) {
    return {
      score: scoreFromCp(-MATE_VALUE),
      bestMove: null,
      pv: [],
      depth: 0,
      terminal: 'checkmate',
    };
  }
  if (chess.isStalemate()) {
    return {
      score: scoreFromCp(0),
      bestMove: null,
      pv: [],
      depth: 0,
      terminal: 'stalemate',
    };
  }
  return null;
}

export function isStandardInitialFen(fen) {
  return fen === START_FEN;
}
