import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  formatEvaluation,
  formatLoss,
  materialDiff,
  normalizeSan,
  parsePgn,
  pvToSan,
  sanListToPgn,
  scoreForMover,
  scoreFromCp,
  scoreFromMate,
  scoreToCp,
  scoreToWhite,
  terminalResult,
  uciToSan,
  isStandardInitialFen,
} from '../src/shared/chess-utils.js';
import { START_FEN } from '../src/shared/constants.js';

const SAMPLE_PGN = `[Event "Тестовая партия"]
[Site "https://lichess.org/test"]
[White "Алиса"]
[Black "Боб"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 1-0
`;

describe('normalizeSan', () => {
  it('cleans move numbers, annotations and figurines', () => {
    expect(normalizeSan('1. e4!')).toBe('e4');
    expect(normalizeSan('12... Nf6?!')).toBe('Nf6');
    expect(normalizeSan('♞f3')).toBe('Nf3');
    expect(normalizeSan('♙e4')).toBe('e4');
    expect(normalizeSan('0-0+')).toBe('O-O+');
    expect(normalizeSan('O-O-O#')).toBe('O-O-O#');
  });

  it('rejects list decorations and noise', () => {
    expect(normalizeSan('')).toBeNull();
    expect(normalizeSan('12...')).toBeNull();
    expect(normalizeSan('e.p.')).toBeNull();
    expect(normalizeSan('комментарий')).toBeNull();
  });
});

describe('parsePgn', () => {
  it('reads headers, moves and the initial position', () => {
    const game = parsePgn(SAMPLE_PGN);
    expect(game.moves).toHaveLength(10);
    expect(game.totalMoves).toBe(10);
    expect(game.white).toBe('Алиса');
    expect(game.black).toBe('Боб');
    expect(game.result).toBe('1-0');
    expect(game.initialFen).toBe(START_FEN);
    expect(game.moves[0].san).toBe('e4');
    expect(game.truncated).toBe(false);
  });

  it('supports a move limit', () => {
    const game = parsePgn(SAMPLE_PGN, { limit: 4 });
    expect(game.moves).toHaveLength(4);
    expect(game.totalMoves).toBe(10);
    expect(game.truncated).toBe(true);
    expect(game.finalFen).toBe(game.moves[3].after);
  });

  it('rejects empty and broken PGN', () => {
    expect(() => parsePgn('   ')).toThrowError(/PGN пустой/);
    expect(() => parsePgn('1. e4 e5 2. Bh6')).toThrowError(/Не удалось прочитать PGN/);
  });

  it('rejects unsupported variants', () => {
    const pgn = `[Variant "Chess960"]\n\n1. e4 e5 *`;
    expect(() => parsePgn(pgn)).toThrowError(/Поддерживаются только обычные шахматы/);
  });
});

describe('sanListToPgn', () => {
  it('round-trips a list of moves', () => {
    const pgn = sanListToPgn(['e4', 'e5', 'Nf3', 'Nc6'], {
      white: 'Алиса',
      black: 'Боб',
      result: '1/2-1/2',
    });
    const game = parsePgn(pgn);
    expect(game.moves.map((move) => move.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(game.white).toBe('Алиса');
    expect(game.black).toBe('Боб');
    expect(game.result).toBe('1/2-1/2');
  });

  it('keeps a non-standard starting position', () => {
    const chess = new Chess();
    chess.move('e4');
    const startFen = chess.fen();
    const pgn = sanListToPgn(['e5', 'Nf3'], { startFen });
    const game = parsePgn(pgn);
    expect(game.initialFen).toBe(startFen);
    expect(game.moves.map((move) => move.san)).toEqual(['e5', 'Nf3']);
  });
});

describe('conversions', () => {
  it('converts UCI moves to SAN', () => {
    expect(uciToSan(START_FEN, 'e2e4')).toBe('e4');
    expect(uciToSan(START_FEN, 'g1f3')).toBe('Nf3');
    expect(uciToSan(START_FEN, 'e2e5')).toBeNull();
  });

  it('converts a principal variation to SAN', () => {
    expect(pvToSan(START_FEN, ['e2e4', 'e7e5', 'g1f3'])).toEqual(['e4', 'e5', 'Nf3']);
    expect(pvToSan(START_FEN, ['e2e4', 'bad', 'g1f3'])).toEqual(['e4']);
  });

  it('handles centipawn and mate scores', () => {
    expect(scoreFromCp(42)).toEqual({ type: 'cp', value: 42 });
    expect(scoreFromMate(-3)).toEqual({ type: 'mate', value: -3 });
    expect(scoreToCp({ type: 'cp', value: 42 })).toBe(42);
    expect(scoreToCp({ type: 'mate', value: 3 })).toBe(99970);
    expect(scoreToCp({ type: 'mate', value: -2 })).toBe(-100020);
    expect(scoreToWhite({ type: 'cp', value: 30 }, 'b')).toEqual({ type: 'cp', value: -30 });
    expect(scoreToWhite({ type: 'mate', value: 2 }, 'b')).toEqual({ type: 'mate', value: -2 });
    expect(scoreForMover({ type: 'cp', value: 30 }, 'b', 'b')).toBe(30);
    expect(scoreForMover({ type: 'cp', value: 30 }, 'b', 'w')).toBe(-30);
  });

  it('formats evaluations from White perspective', () => {
    expect(formatEvaluation({ type: 'cp', value: 35 }, 'w')).toBe('+0,35');
    expect(formatEvaluation({ type: 'cp', value: 35 }, 'b')).toBe('−0,35');
    expect(formatEvaluation({ type: 'cp', value: 0 }, 'w')).toBe('0,00');
    expect(formatEvaluation({ type: 'mate', value: 3 }, 'w')).toBe('мат в 3');
    expect(formatEvaluation({ type: 'mate', value: -2 }, 'w')).toBe('мат в 2 за чёрных');
    expect(formatEvaluation({ type: 'cp', value: 99970 }, 'w')).toBe('мат за белых');
  });

  it('formats pawn losses', () => {
    expect(formatLoss(0)).toBe('без потери');
    expect(formatLoss(120)).toBe('1,20 пешки');
    expect(formatLoss(99970)).toBe('потеря приводит к мату');
  });

  it('computes material difference', () => {
    expect(materialDiff(new Chess(START_FEN))).toBe(0);
    const chess = new Chess();
    chess.move('e4');
    chess.move('d5');
    chess.move('exd5');
    expect(materialDiff(chess)).toBe(100);
  });
});

describe('terminal positions', () => {
  it('detects checkmate and gives the mated side a losing score', () => {
    const chess = new Chess();
    chess.move('f3');
    chess.move('e5');
    chess.move('g4');
    chess.move('Qh4#');
    const terminal = terminalResult(chess.fen());
    expect(terminal?.terminal).toBe('checkmate');
    expect(terminal?.score).toEqual({ type: 'cp', value: -100000 });
    expect(terminal?.bestMove).toBeNull();
  });

  it('detects stalemate as a draw', () => {
    const terminal = terminalResult('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(terminal?.terminal).toBe('stalemate');
    expect(terminal?.score).toEqual({ type: 'cp', value: 0 });
  });

  it('returns null for a normal position', () => {
    expect(terminalResult(START_FEN)).toBeNull();
    expect(isStandardInitialFen(START_FEN)).toBe(true);
  });
});
