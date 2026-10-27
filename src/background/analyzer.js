import { parsePgn, terminalResult } from '../shared/chess-utils.js';
import { fenTurn, buildMoveReport, summarizeAnalysis } from '../shared/analysis.js';

export async function analyzeGame({
  pgn,
  depth = 10,
  maxPlies = 80,
  userColor = null,
  meta = {},
  engine,
  emit,
  isCancelled = () => false,
}) {
  const plan = parsePgn(pgn, { limit: maxPlies > 0 ? maxPlies : undefined });
  const moves = plan.moves;
  const positions = [plan.initialFen, ...moves.map((move) => move.after)];
  const total = positions.length;
  const reports = [];
  const results = [];

  emit({
    type: 'started',
    total,
    totalMoves: plan.totalMoves,
    analyzedMoves: moves.length,
    truncated: plan.truncated,
    white: plan.white,
    black: plan.black,
    result: plan.result,
  });

  for (let index = 0; index < positions.length; index += 1) {
    if (isCancelled()) throw abortError();
    const fen = positions[index];
    const terminal = terminalResult(fen);
    const result = terminal || (await engine.analyze(fen, { depth }));
    if (isCancelled() || result.cancelled) throw abortError();

    results.push(result);
    emit({
      type: 'progress',
      done: index + 1,
      total,
      ply: index,
      terminal: result.terminal || null,
      bestMove: result.bestMove || null,
    });

    if (index > 0) {
      const moveIndex = index - 1;
      const report = buildMoveReport({
        index: moveIndex,
        move: moves[moveIndex],
        beforeResult: results[moveIndex],
        afterResult: result,
        depth,
        userColor,
        truncated: plan.truncated && moveIndex === moves.length - 1,
      });
      reports.push(report);
      emit({
        type: 'move',
        move: report,
        done: reports.length,
        total: moves.length,
      });
    }
  }

  const summary = summarizeAnalysis(reports, {
    totalMoves: plan.totalMoves,
    truncated: plan.truncated,
    depth,
    userColor,
  });

  const analysis = {
    game: {
      white: plan.white,
      black: plan.black,
      result: plan.result,
      initialFen: plan.initialFen,
      headers: plan.headers,
      totalMoves: plan.totalMoves,
      source: meta.source || null,
      sourceLabel: meta.sourceLabel || null,
      url: meta.url || null,
    },
    settings: {
      depth,
      maxPlies,
      userColor,
    },
    moves: reports,
    summary,
    truncated: plan.truncated,
    analyzedMoves: reports.length,
    totalMoves: plan.totalMoves,
    totalPositions: total,
    engine: 'Stockfish 10 (asm.js)',
  };

  emit({ type: 'complete', analysis });
  return analysis;
}

function abortError() {
  const error = new Error('Разбор отменён.');
  error.code = 'ABORTED';
  return error;
}

export { fenTurn };
