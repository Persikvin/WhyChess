import { afterEach, describe, expect, it, vi } from 'vitest';
import { UciEngine, parseUciInfo } from '../src/background/uci-engine.js';
import { START_FEN } from '../src/shared/constants.js';

class FakeWorker {
  constructor(behavior) {
    this.behavior = behavior || (() => {});
    this.onmessage = null;
    this.onerror = null;
    this.posted = [];
    this.terminated = false;
  }

  postMessage(message) {
    this.posted.push(message);
    this.behavior(this, message);
  }

  emit(data) {
    this.onmessage?.({ data });
  }

  terminate() {
    this.terminated = true;
  }
}

function initBehavior(worker, message) {
  if (message === 'uci') worker.emit('id name Fake Stockfish\nuciok');
  else if (message === 'isready') worker.emit('readyok');
}

function defaultBehavior(worker, message) {
  initBehavior(worker, message);
  if (String(message).startsWith('go ')) {
    worker.emit(
      'info depth 5 seldepth 6 multipv 1 score cp 34 nodes 1000 nps 2000 time 5 pv e2e4 e7e5',
    );
    worker.emit(
      'info depth 9 seldepth 10 multipv 2 score cp 500 nodes 1200 nps 2100 time 6 pv d2d4',
    );
    worker.emit(
      'info depth 6 seldepth 7 multipv 1 score cp 40 nodes 3000 nps 3000 time 8 pv d2d4 d7d5',
    );
    worker.emit('bestmove d2d4 ponder d7d5');
  }
}

function createEngine(behavior = defaultBehavior) {
  let worker = null;
  let created = 0;
  const engine = new UciEngine({
    workerUrl: 'fake-stockfish.js',
    workerFactory: () => {
      created += 1;
      worker = new FakeWorker(behavior);
      return worker;
    },
  });
  return {
    engine,
    get worker() {
      return worker;
    },
    get created() {
      return created;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('parseUciInfo', () => {
  it('parses scores, depth and the principal variation', () => {
    expect(
      parseUciInfo(
        'info depth 10 seldepth 12 multipv 1 score mate -3 nodes 123 nps 456 time 7 pv h7h8q',
      ),
    ).toEqual({
      depth: 10,
      multipv: 1,
      nodes: 123,
      nps: 456,
      time: 7,
      score: { type: 'mate', value: -3 },
      pv: ['h7h8q'],
    });
  });

  it('defaults optional counters', () => {
    expect(parseUciInfo('info depth 3 score cp 12 pv e2e4')).toEqual({
      depth: 3,
      multipv: 1,
      nodes: 0,
      nps: 0,
      time: 0,
      score: { type: 'cp', value: 12 },
      pv: ['e2e4'],
    });
  });

  it('ignores lines without an evaluation or variation', () => {
    expect(parseUciInfo('bestmove e2e4')).toBeNull();
    expect(parseUciInfo('info depth 5 currmove e2e4')).toBeNull();
    expect(parseUciInfo('info string NNUE evaluation using ...')).toBeNull();
    expect(parseUciInfo(null)).toBeNull();
  });
});

describe('UciEngine', () => {
  it('performs the UCI handshake once', async () => {
    const context = createEngine();
    await context.engine.init();
    expect(context.created).toBe(1);
    expect(context.engine.ready).toBe(true);
    expect(context.worker.posted).toEqual([
      'uci',
      // This bundled asm.js build has one fixed thread and hangs if the
      // Threads option is set explicitly, so only Hash may be configured.
      'setoption name Hash value 16',
      'isready',
    ]);

    await context.engine.init();
    expect(context.created).toBe(1);
  });

  it('returns the deepest single-PV result', async () => {
    const context = createEngine();
    const result = await context.engine.analyze(START_FEN, { depth: 10 });

    expect(result.fen).toBe(START_FEN);
    expect(result.bestMove).toBe('d2d4');
    expect(result.depth).toBe(6);
    expect(result.score).toEqual({ type: 'cp', value: 40 });
    expect(result.pv).toEqual(['d2d4', 'd7d5']);
    expect(result.cancelled).toBe(false);
    expect(context.worker.posted).toContain(`position fen ${START_FEN}`);
    expect(context.worker.posted).toContain('go depth 10');
  });

  it('clamps the requested depth', async () => {
    const context = createEngine();
    await context.engine.analyze(START_FEN, { depth: 100 });
    expect(context.worker.posted).toContain('go depth 30');
  });

  it('treats (none) as no best move', async () => {
    const { engine } = createEngine((worker, message) => {
      initBehavior(worker, message);
      if (String(message).startsWith('go ')) worker.emit('bestmove (none)');
    });
    const result = await engine.analyze('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(result.bestMove).toBeNull();
  });

  it('rejects a second search while the engine is busy', async () => {
    const { engine } = createEngine((worker, message) => initBehavior(worker, message));
    await engine.init();
    const first = engine.analyze(START_FEN, { depth: 10 });

    await expect(engine.analyze(START_FEN, { depth: 10 })).rejects.toThrow(
      'Движок уже занят другим расчётом.',
    );

    engine.destroy();
    await expect(first).rejects.toThrow('Движок остановлен.');
  });

  it('cancels an active search and resolves it as cancelled', async () => {
    const { engine } = createEngine((worker, message) => {
      initBehavior(worker, message);
      if (message === 'stop') worker.emit('bestmove (none)');
    });
    const search = engine.analyze(START_FEN, { depth: 10 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await engine.cancel();

    const result = await search;
    expect(result.cancelled).toBe(true);
    expect(result.bestMove).toBeNull();
    expect(engine.ready).toBe(true);
  });

  it('aborts a search cancelled during engine startup', async () => {
    let worker = null;
    const engine = new UciEngine({
      workerUrl: 'fake.js',
      workerFactory: () => {
        worker = new FakeWorker(() => {});
        return worker;
      },
    });

    const search = engine.analyze(START_FEN, { depth: 10 });
    await Promise.resolve();
    await engine.cancel();
    worker.emit('uciok');
    worker.emit('readyok');

    await expect(search).rejects.toMatchObject({ code: 'ABORTED' });
    expect(worker.posted).not.toContain('go depth 10');
    expect(engine.active).toBeNull();
  });

  it('reports worker creation failures', async () => {
    const engine = new UciEngine({
      workerUrl: 'missing.js',
      workerFactory: () => {
        throw new Error('boom');
      },
    });

    await expect(engine.init()).rejects.toThrow(
      'Не удалось создать поток движка: boom',
    );
    await expect(engine.init()).rejects.toThrow(
      'Не удалось создать поток движка: boom',
    );
  });

  it('reports worker runtime errors', async () => {
    const worker = new FakeWorker(() => {});
    const engine = new UciEngine({
      workerUrl: 'fake.js',
      workerFactory: () => worker,
    });
    const init = engine.init();
    worker.onerror({ message: 'crash' });

    await expect(init).rejects.toThrow('Ошибка движка Stockfish: crash');
    expect(engine.fatalError).toBeInstanceOf(Error);
    await expect(engine.analyze(START_FEN)).rejects.toThrow(
      'Ошибка движка Stockfish: crash',
    );
  });

  it('times out a search that never finishes', async () => {
    const { engine } = createEngine((worker, message) => initBehavior(worker, message));
    await engine.init();
    vi.useFakeTimers();

    const search = engine.analyze(START_FEN, { depth: 5, timeoutMs: 100 });
    const assertion = expect(search).rejects.toThrow(
      'Расчёт одной позиции занял слишком много времени.',
    );
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(engine.active).toBeNull();
  });
});
