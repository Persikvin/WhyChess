import { Chess } from 'chess.js';
import {
  CLASSIFICATION_META,
  ERROR_CLASSIFICATIONS,
} from './constants.js';
import {
  evaluationSummary,
  formatEvaluation,
  pvToSan,
  scoreForMover,
  scoreToWhite,
  scoreToCp,
  uciToSan,
} from './chess-utils.js';
import { analyzeMove } from './features.js';
import { buildExplanationRich } from './explain.js';

export function classifyLoss(lossCp, { playedIsBest = false, forced = false } = {}) {
  if (forced) return 'forced';
  if (playedIsBest) return 'best';
  if (lossCp <= 25) return 'excellent';
  if (lossCp <= 60) return 'good';
  if (lossCp <= 120) return 'inaccuracy';
  if (lossCp <= 300) return 'mistake';
  return 'blunder';
}

export function buildMoveReport({
  index,
  move,
  beforeResult,
  afterResult,
  depth,
  userColor,
  truncated = false,
}) {
  const fenBefore = move.before;
  const fenAfter = move.after;
  const turn = fenTurn(fenBefore);
  const afterTurn = fenTurn(fenAfter);
  const bestUci = beforeResult.bestMove;
  const playedUci = move.lan || `${move.from}${move.to}${move.promotion || ''}`;
  const playedIsBest = Boolean(bestUci && playedUci === bestUci);
  const legalMoves = new Chess(fenBefore).moves().length;
  const forced = legalMoves === 1;

  const bestForMover = scoreForMover(beforeResult.score, turn, move.color);
  const afterForMover = scoreForMover(afterResult.score, afterTurn, move.color);
  const lossCp = Math.max(0, Math.round(bestForMover - afterForMover));
  const classification = classifyLoss(lossCp, { playedIsBest, forced });

  const bestSan = bestUci ? uciToSan(fenBefore, bestUci) : null;
  const bestPvSan = bestUci ? pvToSan(fenBefore, beforeResult.pv?.length ? beforeResult.pv : [bestUci]) : [];
  const bestFeatures = bestUci
    ? analyzeMove(fenBefore, {
        from: bestUci.slice(0, 2),
        to: bestUci.slice(2, 4),
        promotion: bestUci.length > 4 ? bestUci[4] : undefined,
      })
    : null;
  const playedFeatures = analyzeMove(fenBefore, move);
  const whiteBefore = scoreToWhite(beforeResult.score, turn);
  const whiteAfter = scoreToWhite(afterResult.score, afterTurn);

  const refutation =
    !playedIsBest && afterResult.bestMove
      ? {
          san: uciToSan(fenAfter, afterResult.bestMove),
          uci: afterResult.bestMove,
          pvSan: pvToSan(fenAfter, afterResult.pv?.length ? afterResult.pv : [afterResult.bestMove]),
        }
      : null;

  const explanationContext = {
    bestFeatures,
    playedFeatures,
    forced,
    isBest: playedIsBest,
    classification,
    lossCp,
    bestScore: beforeResult.score,
    turn,
    afterScore: afterResult.score,
    afterTurn,
    bestPvSan,
    refutation,
    depth,
    truncated,
    bestSan,
  };
  // The content script may learn the player's colour after the analysis has
  // already started (or correct an earlier guess). Keep both wordings so the
  // panel can switch sides without re-running Stockfish.
  const explanationRichVariants = {
    user: buildExplanationRich({ ...explanationContext, isUser: true }),
    opponent: buildExplanationRich({ ...explanationContext, isUser: false }),
  };
  const explanationVariants = {
    user: explanationText(explanationRichVariants.user),
    opponent: explanationText(explanationRichVariants.opponent),
  };
  const isUser = Boolean(userColor && move.color === userColor);
  const explanation = isUser ? explanationVariants.user : explanationVariants.opponent;
  const explanationRich = isUser
    ? explanationRichVariants.user
    : explanationRichVariants.opponent;

  return {
    index,
    ply: index + 1,
    moveNumber: fullMoveNumber(fenBefore),
    color: move.color,
    sideLabel: move.color === 'w' ? 'белые' : 'чёрные',
    san: move.san,
    uci: playedUci,
    from: move.from,
    to: move.to,
    piece: move.piece,
    captured: move.captured || null,
    promotion: move.promotion || null,
    fenBefore,
    fenAfter,
    isUser,
    classification,
    label: CLASSIFICATION_META[classification]?.label || '',
    tone: CLASSIFICATION_META[classification]?.tone || 'good',
    lossCp,
    explanation,
    explanationVariants,
    explanationRich,
    explanationRichVariants,
    bestMove: bestUci
      ? {
          uci: bestUci,
          san: bestSan,
          from: bestUci.slice(0, 2),
          to: bestUci.slice(2, 4),
          promotion: bestUci.length > 4 ? bestUci[4] : null,
          evalText: formatEvaluation(beforeResult.score, turn),
          evalSummary: evaluationSummary(beforeResult.score, turn),
          whiteCp: scoreToCp(whiteBefore),
          pvSan: bestPvSan,
          depth: beforeResult.depth || depth,
          features: bestFeatures
            ? {
                piece: bestFeatures.piece,
                isCapture: bestFeatures.isCapture,
                isCheck: bestFeatures.isCheck,
                isCheckmate: bestFeatures.isCheckmate,
                isCastle: bestFeatures.isCastle,
              }
            : null,
        }
      : null,
    playedEval: {
      evalText: formatEvaluation(afterResult.score, afterTurn),
      evalSummary: evaluationSummary(afterResult.score, afterTurn),
      whiteCp: scoreToCp(whiteAfter),
      terminal: afterResult.terminal || null,
    },
    refutation,
  };
}

/**
 * Aligns a ready move report with the player's colour known by the panel.
 * Reports carry both explanation wordings, so this is a pure relabelling that
 * never needs another engine run. Returns the same object when nothing changed.
 */
export function applyUserColor(report, userColor) {
  if (!report) return report;
  const isUser = Boolean(userColor && report.color === userColor);
  const variants = report.explanationVariants;
  const richVariants = report.explanationRichVariants;
  const explanation = Array.isArray(variants?.user) && Array.isArray(variants?.opponent)
    ? (isUser ? variants.user : variants.opponent)
    : report.explanation;
  const explanationRich = Array.isArray(richVariants?.user) && Array.isArray(richVariants?.opponent)
    ? (isUser ? richVariants.user : richVariants.opponent)
    : report.explanationRich;
  if (
    report.isUser === isUser &&
    explanation === report.explanation &&
    explanationRich === report.explanationRich
  ) {
    return report;
  }
  return { ...report, isUser, explanation, explanationRich };
}

function explanationText(paragraphs) {
  return paragraphs.map((tokens) => tokens.map((token) => token.text).join(''));
}

export function summarizeAnalysis(moves, options = {}) {
  const counts = Object.fromEntries(Object.keys(CLASSIFICATION_META).map((key) => [key, 0]));
  for (const move of moves) {
    counts[move.classification] = (counts[move.classification] || 0) + 1;
  }

  const userMoves = options.userColor
    ? moves.filter((move) => move.color === options.userColor)
    : [];
  const userCounts = Object.fromEntries(Object.keys(CLASSIFICATION_META).map((key) => [key, 0]));
  for (const move of userMoves) {
    userCounts[move.classification] = (userCounts[move.classification] || 0) + 1;
  }

  const errors = moves.filter((move) => ERROR_CLASSIFICATIONS.includes(move.classification));
  const userErrors = userMoves.filter((move) => ERROR_CLASSIFICATIONS.includes(move.classification));
  const avgLoss = moves.length
    ? Math.round(moves.reduce((sum, move) => sum + move.lossCp, 0) / moves.length)
    : 0;
  const userAvgLoss = userMoves.length
    ? Math.round(userMoves.reduce((sum, move) => sum + move.lossCp, 0) / userMoves.length)
    : 0;

  return {
    analyzedMoves: moves.length,
    totalMoves: options.totalMoves ?? moves.length,
    truncated: Boolean(options.truncated),
    depth: options.depth,
    userColor: options.userColor || null,
    counts,
    userCounts,
    errorCount: errors.length,
    userErrorCount: userErrors.length,
    bestCount: counts.best + counts.excellent,
    userBestCount: userCounts.best + userCounts.excellent,
    avgLoss,
    userAvgLoss,
    hasErrors: errors.length > 0,
  };
}

export function fenTurn(fen) {
  const fields = String(fen).split(/\s+/);
  return fields[1] === 'b' ? 'b' : 'w';
}

function fullMoveNumber(fen) {
  const fields = String(fen).split(/\s+/);
  const number = Number.parseInt(fields[5] || '1', 10);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

export function isBlunderOrWorse(lossCp) {
  return lossCp > 300;
}
