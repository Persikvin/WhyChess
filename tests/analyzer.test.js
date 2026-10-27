import { describe, expect, it } from 'vitest';
import { analyzeGame } from '../src/background/analyzer.js';
import { parsePgn, sanListToPgn } from '../src/shared/chess-utils.js';
import { START_FEN } from '../src/shared/constants.js';

function makeEngine(results) {
  const calls = [];
  return {
    calls,
    async analyze(fen, options = {}) {
      calls.push({ fen, ...options });
      const index = calls.length - 1;
      return {
        fen,
        ...results[index],
      };
    },
  };
}

function result(bestMove, value = 0, pv = []) {
  return {
    bestMove,
    score: { type: 'cp', value },
    pv: pv.length ? pv : bestMove ? [bestMove] : [],
    depth: 10,
  };
}

const PGN = sanListToPgn(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], {
  white: 'Алиса',
  black: 'Боб',
  result: '1-0',
});

describe('analyzeGame', () => {
  it('analyses every position and emits incremental events', async () => {
    const engine = makeEngine([
      result('e2e4', 20, ['e2e4', 'e7e5']),
      result('e7e5', 15, ['e7e5', 'g1f3']),
      result('g1f3', 20, ['g1f3', 'b8c6']),
      result('b8c6', 15, ['b8c6', 'f1b5']),
      result('f1b5', 25, ['f1b5', 'a7a6']),
      result('a7a6', 20, ['a7a6']),
    ]);
    const events = [];
    const emit = (event) => events.push(event);

    const analysis = await analyzeGame({
      pgn: PGN,
      depth: 10,
      maxPlies: 80,
      userColor: 'w',
      meta: { source: 'lichess', sourceLabel: 'Lichess', url: 'https://lichess.org/test' },
      engine,
      emit,
    });

    expect(engine.calls).toHaveLength(6);
    expect(engine.calls.every((call) => call.depth === 10)).toBe(true);

    const started = events.find((event) => event.type === 'started');
    expect(started).toMatchObject({
      total: 6,
      totalMoves: 5,
      analyzedMoves: 5,
      truncated: false,
      white: 'Алиса',
      black: 'Боб',
      result: '1-0',
    });
    expect(events.filter((event) => event.type === 'progress')).toHaveLength(6);
    expect(events.filter((event) => event.type === 'move')).toHaveLength(5);
    expect(events.filter((event) => event.type === 'complete')).toHaveLength(1);

    expect(analysis.totalPositions).toBe(6);
    expect(analysis.totalMoves).toBe(5);
    expect(analysis.analyzedMoves).toBe(5);
    expect(analysis.moves).toHaveLength(5);
    expect(analysis.engine).toBe('Stockfish 10 (asm.js)');
    expect(analysis.game).toMatchObject({
      white: 'Алиса',
      black: 'Боб',
      result: '1-0',
      initialFen: START_FEN,
      source: 'lichess',
      sourceLabel: 'Lichess',
      url: 'https://lichess.org/test',
    });
    expect(analysis.settings).toEqual({ depth: 10, maxPlies: 80, userColor: 'w' });

    expect(analysis.moves.map((move) => move.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    expect(analysis.moves.every((move) => move.classification === 'best')).toBe(true);
    expect(analysis.moves.map((move) => move.isUser)).toEqual([true, false, true, false, true]);
    expect(analysis.moves[0].fenBefore).toBe(START_FEN);
    expect(analysis.moves[0].fenAfter).toBe(parsePgn(PGN).moves[0].after);
    expect(analysis.moves[4].moveNumber).toBe(3);

    expect(analysis.summary).toMatchObject({
      analyzedMoves: 5,
      totalMoves: 5,
      truncated: false,
      depth: 10,
      userColor: 'w',
      errorCount: 0,
      userErrorCount: 0,
      bestCount: 5,
      userBestCount: 3,
      hasErrors: false,
    });
    expect(analysis.summary.counts.best).toBe(5);
    expect(analysis.summary.userCounts.best).toBe(3);
  });

  it('scores the final checkmate without asking the engine', async () => {
    const engine = makeEngine([
      result('e2e4', 20),
      result('e7e5', 30),
      result('g2g4', 10),
      { bestMove: 'd8h4', score: { type: 'mate', value: 1 }, pv: ['d8h4'], depth: 10 },
    ]);
    const events = [];
    const analysis = await analyzeGame({
      pgn: sanListToPgn(['f3', 'e5', 'g4', 'Qh4#'], { result: '0-1' }),
      depth: 10,
      engine,
      emit: (event) => events.push(event),
    });

    expect(engine.calls).toHaveLength(4);
    expect(events.filter((event) => event.type === 'progress')).toHaveLength(5);
    const terminalProgress = events.filter((event) => event.type === 'progress').at(-1);
    expect(terminalProgress.terminal).toBe('checkmate');

    expect(analysis.moves).toHaveLength(4);
    expect(analysis.moves[3].san).toBe('Qh4#');
    expect(analysis.moves[3].classification).toBe('best');
    expect(analysis.moves[3].playedEval.terminal).toBe('checkmate');
    expect(analysis.summary.errorCount).toBe(0);
  });

  it('stops with an ABORTED error when cancelled', async () => {
    const engine = makeEngine([result('e2e4', 20)]);
    const events = [];
    let checks = 0;
    const error = await analyzeGame({
      pgn: PGN,
      depth: 10,
      engine,
      emit: (event) => events.push(event),
      isCancelled: () => {
        checks += 1;
        return checks > 2;
      },
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('ABORTED');
    expect(error.message).toBe('Разбор отменён.');
    expect(engine.calls).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual(['started', 'progress']);
  });

  it('marks truncated reviews and notes the limit on the last move', async () => {
    const engine = makeEngine([
      result('e2e4', 20),
      result('e7e5', 15),
      result('g1f3', 20),
    ]);
    const analysis = await analyzeGame({
      pgn: PGN,
      depth: 10,
      maxPlies: 2,
      engine,
      emit: () => {},
    });

    expect(engine.calls).toHaveLength(3);
    expect(analysis.truncated).toBe(true);
    expect(analysis.moves).toHaveLength(2);
    expect(analysis.summary).toMatchObject({
      analyzedMoves: 2,
      totalMoves: 5,
      truncated: true,
    });
    expect(analysis.moves[0].explanation.join(' ')).not.toContain('не до конца');
    expect(analysis.moves[1].explanation.join(' ')).toContain('не до конца');
  });

  it('treats maxPlies <= 0 as no limit', async () => {
    const engine = makeEngine(
      Array.from({ length: 6 }, (_, index) => result(index === 5 ? 'a7a6' : 'e2e4', 20)),
    );
    const analysis = await analyzeGame({
      pgn: PGN,
      depth: 10,
      maxPlies: 0,
      engine,
      emit: () => {},
    });
    expect(analysis.moves).toHaveLength(5);
    expect(analysis.truncated).toBe(false);
  });

  it('rejects an invalid PGN before emitting anything', async () => {
    const engine = makeEngine([]);
    const events = [];
    await expect(
      analyzeGame({
        pgn: '1. e4 e5 2. Bh6',
        engine,
        emit: (event) => events.push(event),
      }),
    ).rejects.toThrow(/Не удалось прочитать PGN/);
    expect(events).toHaveLength(0);
  });
});
