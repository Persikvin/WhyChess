import { Chess } from 'chess.js';
import { PIECE_VALUES } from './constants.js';

const CENTER_SQUARES = ['d4', 'e4', 'd5', 'e5'];
const HOME_MINOR_SQUARES = {
  w: new Set(['b1', 'c1', 'f1', 'g1']),
  b: new Set(['b8', 'c8', 'f8', 'g8']),
};
const HOME_RANK = { w: 1, b: 8 };

export function oppositeColor(color) {
  return color === 'w' ? 'b' : 'w';
}

export function boardMetrics(chess) {
  const board = chess.board().flat().filter(Boolean);
  const material = { w: 0, b: 0 };
  const development = { w: 0, b: 0 };
  const vulnerable = { w: [], b: [] };
  const kingSquare = { w: null, b: null };

  for (const piece of board) {
    material[piece.color] += PIECE_VALUES[piece.type] || 0;
    if (piece.type === 'k') kingSquare[piece.color] = piece.square;
    if (
      (piece.type === 'n' || piece.type === 'b') &&
      !HOME_MINOR_SQUARES[piece.color].has(piece.square)
    ) {
      development[piece.color] += 1;
    }

    if (piece.type !== 'k') {
      const attackers = chess.attackers(piece.square, oppositeColor(piece.color));
      if (attackers.length > 0) {
        const defenders = chess.attackers(piece.square, piece.color);
        const cheapestAttacker = Math.min(
          ...attackers.map((square) => {
            const attacker = chess.get(square);
            return attacker ? PIECE_VALUES[attacker.type] : 10000;
          }),
        );
        const value = PIECE_VALUES[piece.type] || 0;
        if (defenders.length === 0 || cheapestAttacker < value) {
          vulnerable[piece.color].push({
            square: piece.square,
            type: piece.type,
            value,
            defended: defenders.length > 0,
            attackers,
          });
        }
      }
    }
  }

  const pawnFiles = { w: new Map(), b: new Map() };
  for (const piece of board) {
    if (piece.type !== 'p') continue;
    const file = piece.square[0];
    pawnFiles[piece.color].set(file, (pawnFiles[piece.color].get(file) || 0) + 1);
  }

  const pawnStructure = {
    w: calculatePawnStructure(pawnFiles.w),
    b: calculatePawnStructure(pawnFiles.b),
  };
  const centerControl = { w: 0, b: 0 };
  for (const color of ['w', 'b']) {
    for (const square of CENTER_SQUARES) {
      if (chess.attackers(square, color).length > 0) centerControl[color] += 1;
    }
  }

  return {
    turn: chess.turn(),
    material: {
      ...material,
      diff: material.w - material.b,
    },
    development,
    vulnerable: {
      w: vulnerable.w,
      b: vulnerable.b,
    },
    king: {
      w: kingZone(chess, 'w', kingSquare.w, pawnFiles),
      b: kingZone(chess, 'b', kingSquare.b, pawnFiles),
    },
    pawnStructure,
    centerControl,
    openFiles: openFiles(pawnFiles),
    mobility: chess.moves().length,
  };
}

function calculatePawnStructure(files) {
  let doubled = 0;
  let isolated = 0;
  const fileOrder = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  for (let index = 0; index < fileOrder.length; index += 1) {
    const file = fileOrder[index];
    const count = files.get(file) || 0;
    if (count > 1) doubled += count - 1;
    if (count > 0) {
      const left = files.get(fileOrder[index - 1]) || 0;
      const right = files.get(fileOrder[index + 1]) || 0;
      if (left === 0 && right === 0) isolated += 1;
    }
  }
  return { doubled, isolated };
}

function openFiles(pawnFiles) {
  const fileOrder = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  return fileOrder.filter(
    (file) => (pawnFiles.w.get(file) || 0) === 0 && (pawnFiles.b.get(file) || 0) === 0,
  );
}

function kingZone(chess, color, kingSquare, pawnFiles) {
  if (!kingSquare) return { castled: false, shield: 0, openFiles: [] };
  const file = kingSquare[0];
  const rank = Number(kingSquare[1]);
  const direction = color === 'w' ? 1 : -1;
  const fileOrder = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const fileIndex = fileOrder.indexOf(file);
  const shieldSquares = [];
  for (const offset of [-1, 0, 1]) {
    const shieldFile = fileOrder[fileIndex + offset];
    if (!shieldFile) continue;
    shieldSquares.push(`${shieldFile}${rank + direction}`);
    if (rank + direction * 2 >= 1 && rank + direction * 2 <= 8) {
      shieldSquares.push(`${shieldFile}${rank + direction * 2}`);
    }
  }
  const shield = shieldSquares.reduce((count, square) => {
    const piece = chess.get(square);
    return count + (piece && piece.type === 'p' && piece.color === color ? 1 : 0);
  }, 0);

  const homeRank = HOME_RANK[color];
  const castled =
    rank === homeRank &&
    (kingSquare === `g${homeRank}` || kingSquare === `c${homeRank}`) &&
    Boolean(chess.get(kingSquare === `g${homeRank}` ? `f${homeRank}` : `d${homeRank}`));
  const nearFiles = [fileOrder[fileIndex - 1], file, fileOrder[fileIndex + 1]].filter(Boolean);
  const openNearKing = nearFiles.filter(
    (nearFile) => (pawnFiles[color].get(nearFile) || 0) === 0,
  );

  return { castled, shield, openFiles: openNearKing };
}

export function analyzeMove(fenBefore, moveInput) {
  if (!moveInput?.from || !moveInput?.to) return null;
  const before = new Chess(fenBefore);
  const chess = new Chess(fenBefore);
  let move;
  try {
    move = chess.move({
      from: moveInput.from,
      to: moveInput.to,
      promotion: moveInput.promotion ? String(moveInput.promotion).toLowerCase() : undefined,
    });
  } catch {
    return null;
  }
  if (!move) return null;

  const metricsBefore = boardMetrics(before);
  const metricsAfter = boardMetrics(chess);
  const color = move.color;
  const enemy = oppositeColor(color);
  const centerSquaresAttacked = CENTER_SQUARES.filter((square) =>
    chess.attackers(square, color).includes(move.to),
  );
  const attackedEnemy = [];
  for (const piece of chess.board().flat().filter(Boolean)) {
    if (piece.color !== enemy || piece.type === 'k') continue;
    if (!chess.attackers(piece.square, color).includes(move.to)) continue;
    const defenders = chess.attackers(piece.square, enemy);
    attackedEnemy.push({
      square: piece.square,
      type: piece.type,
      value: PIECE_VALUES[piece.type] || 0,
      defended: defenders.length > 0,
    });
  }
  const attackedEnemyVulnerable = attackedEnemy.filter(
    (piece) => piece.value >= 300 && (!piece.defended || piece.value > (PIECE_VALUES[move.piece] || 0)),
  );

  const fromVulnerableBefore = metricsBefore.vulnerable[color].find(
    (piece) => piece.square === move.from,
  );
  const vulnerableAfter = metricsAfter.vulnerable[color];
  const resolvedThreats = metricsBefore.vulnerable[color]
    .filter((piece) => {
      if (piece.value < 300) return false;
      if (piece.square === move.from) return true;
      return !vulnerableAfter.some(
        (after) => after.square === piece.square && after.type === piece.type,
      );
    })
    .map((piece) => ({
      ...piece,
      movedAway: piece.square === move.from,
    }));

  const castleFlag = move.flags.includes('k') ? 'kingside' : move.flags.includes('q') ? 'queenside' : null;
  const openFileAfter =
    (move.piece === 'r' || move.piece === 'q') && metricsAfter.openFiles.includes(move.to[0]);

  return {
    move,
    beforeFen: fenBefore,
    afterFen: chess.fen(),
    color,
    piece: move.piece,
    from: move.from,
    to: move.to,
    san: move.san,
    captured: move.captured,
    promotion: move.promotion,
    flags: move.flags,
    isCastle: Boolean(castleFlag),
    castleSide: castleFlag,
    isEnPassant: move.flags.includes('e'),
    isCapture: Boolean(move.captured) || move.flags.includes('e'),
    isCheck: chess.inCheck(),
    isCheckmate: chess.isCheckmate(),
    isStalemate: chess.isStalemate(),
    isPromotion: Boolean(move.promotion),
    isDeveloping:
      (move.piece === 'n' || move.piece === 'b') &&
      Math.floor(Number(move.from[1])) === HOME_RANK[color] &&
      !HOME_MINOR_SQUARES[color].has(move.to),
    metricsBefore,
    metricsAfter,
    centerSquaresAttacked,
    centerControlGain: metricsAfter.centerControl[color] - metricsBefore.centerControl[color],
    attackedEnemy,
    attackedEnemyVulnerable,
    isFork: attackedEnemyVulnerable.length >= 2,
    openFileAfter,
    movedIntoAttack: chess.attackers(move.to, enemy),
    movedPieceWasVulnerable: Boolean(fromVulnerableBefore),
    resolvedThreats,
    materialDiffBefore: metricsBefore.material.diff,
    materialDiffAfter: metricsAfter.material.diff,
    opponentMobilityAfter: metricsAfter.mobility,
  };
}

export function boardFacts(fen) {
  return boardMetrics(new Chess(fen));
}
