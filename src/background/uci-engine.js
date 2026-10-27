/**
 * Small UCI client for the bundled Stockfish 10 asm.js build.
 *
 * The asm.js worker is deliberately used instead of the newer WASM builds:
 * it is a plain classic worker, needs no cross-origin isolation and works in
 * Firefox extension pages without special headers.
 */
export class UciEngine {
  constructor({ workerUrl, workerFactory, log = () => {} }) {
    this.workerUrl = workerUrl;
    this.workerFactory = workerFactory || ((url) => new Worker(url));
    this.log = log;
    this.worker = null;
    this.ready = false;
    this.active = null;
    this.initPromise = null;
    this.fatalError = null;
    this.cancelVersion = 0;
  }

  async init() {
    if (this.ready) return;
    if (this.fatalError) throw this.fatalError;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        fail(new Error('Движок Stockfish не ответил при запуске.'));
      }, 30000);

      const succeed = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ready = true;
        resolve();
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.fail(error);
        reject(error);
      };

      try {
        this.worker = this.workerFactory(this.workerUrl);
      } catch (error) {
        fail(new Error(`Не удалось создать поток движка: ${error.message}`));
        return;
      }

      let gotUci = false;
      this.worker.onmessage = (event) => {
        const lines = splitLines(event.data);
        for (const line of lines) {
          if (!gotUci && line === 'uciok') {
            gotUci = true;
            try {
              // This asm.js build is compiled with a single fixed thread and
              // hangs if the Threads option is set explicitly. The Hash option
              // is harmless and its 16 MB value is the build's fixed maximum.
              this.worker.postMessage('setoption name Hash value 16');
              this.worker.postMessage('isready');
            } catch (error) {
              fail(new Error(`Не удалось настроить движок: ${error.message}`));
            }
            continue;
          }
          if (gotUci && !this.ready && line === 'readyok') {
            succeed();
            continue;
          }
          if (this.ready) this.handleLine(line);
        }
      };
      this.worker.onerror = (event) => {
        const message = event?.message || 'неизвестная ошибка';
        fail(new Error(`Ошибка движка Stockfish: ${message}`));
      };

      try {
        this.worker.postMessage('uci');
      } catch (error) {
        fail(new Error(`Не удалось запустить движок: ${error.message}`));
      }
    }).catch((error) => {
      this.initPromise = null;
      throw error;
    });

    return this.initPromise;
  }

  async analyze(fen, options = {}) {
    const cancelVersion = this.cancelVersion;
    await this.init();
    if (this.fatalError) throw this.fatalError;
    // A cancel may arrive while the engine is still starting; without this
    // check the caller would wait for a whole search before noticing it.
    if (cancelVersion !== this.cancelVersion) throw abortError();
    if (this.active) throw new Error('Движок уже занят другим расчётом.');

    const depth = Math.max(1, Math.min(30, Math.round(options.depth || 10)));
    const timeoutMs = options.timeoutMs ?? Math.max(45000, depth * 6000);

    return new Promise((resolve, reject) => {
      let finishSearch;
      const finished = new Promise((done) => {
        finishSearch = done;
      });
      const request = {
        fen,
        depth,
        best: {
          score: { type: 'cp', value: 0 },
          pv: [],
          depth: 0,
          nodes: 0,
          nps: 0,
          time: 0,
        },
        cancelled: false,
        resolve: (value) => {
          finishSearch();
          resolve(value);
        },
        reject: (error) => {
          finishSearch();
          reject(error);
        },
        finished,
        timeout: null,
      };

      request.timeout = setTimeout(() => {
        if (this.active !== request) return;
        request.cancelled = true;
        try {
          this.worker.postMessage('stop');
        } catch {
          // The worker may already be gone.
        }
        request.timeout = setTimeout(() => {
          if (this.active !== request) return;
          this.active = null;
          request.reject(new Error('Расчёт одной позиции занял слишком много времени.'));
        }, 5000);
      }, timeoutMs);

      this.active = request;
      try {
        this.worker.postMessage(`position fen ${fen}`);
        this.worker.postMessage(`go depth ${depth}`);
      } catch (error) {
        clearTimeout(request.timeout);
        this.active = null;
        request.reject(new Error(`Не удалось передать позицию движку: ${error.message}`));
      }
    });
  }

  async cancel() {
    this.cancelVersion += 1;
    const request = this.active;
    if (!request) return;
    request.cancelled = true;
    try {
      this.worker?.postMessage('stop');
    } catch {
      // Ignore a worker that is already shutting down.
    }
    await Promise.race([request.finished, delay(4000)]);
    if (this.active === request) {
      this.destroy();
    }
  }

  stop() {
    try {
      this.worker?.postMessage('stop');
    } catch {
      // Ignore.
    }
  }

  destroy() {
    const request = this.active;
    if (request) {
      clearTimeout(request.timeout);
      this.active = null;
      request.reject(new Error('Движок остановлен.'));
    }
    try {
      this.worker?.terminate();
    } catch {
      // Ignore.
    }
    this.worker = null;
    this.ready = false;
    this.initPromise = null;
    this.fatalError = null;
  }

  fail(error) {
    this.fatalError = error;
    if (this.active) {
      const request = this.active;
      this.active = null;
      clearTimeout(request.timeout);
      request.reject(error);
    }
  }

  handleLine(line) {
    if (!line) return;
    if (line.startsWith('bestmove')) {
      const request = this.active;
      if (!request) return;
      clearTimeout(request.timeout);
      this.active = null;
      const parts = line.split(/\s+/);
      const bestMove = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
      request.resolve({
        fen: request.fen,
        ...request.best,
        bestMove,
        cancelled: request.cancelled,
      });
      return;
    }

    if (!line.startsWith('info ')) return;
    const info = parseUciInfo(line);
    if (!info) return;
    const request = this.active;
    if (!request || info.multipv > 1) return;
    if (
      info.depth > request.best.depth ||
      (info.depth === request.best.depth && info.pv.length >= request.best.pv.length)
    ) {
      request.best = {
        score: info.score || request.best.score,
        pv: info.pv.length ? info.pv : request.best.pv,
        depth: info.depth || request.best.depth,
        nodes: info.nodes || request.best.nodes,
        nps: info.nps || request.best.nps,
        time: info.time || request.best.time,
      };
    }
  }
}

export function parseUciInfo(line) {
  if (typeof line !== 'string' || !line.startsWith('info ')) return null;
  if (line.includes(' score ') || line.includes(' pv ')) {
    const depth = numberToken(line, 'depth');
    const multipv = numberToken(line, 'multipv') || 1;
    const nodes = numberToken(line, 'nodes') || 0;
    const nps = numberToken(line, 'nps') || 0;
    const time = numberToken(line, 'time') || 0;
    const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
    const pvMatch = line.match(/\bpv (.+)$/);
    const score = scoreMatch
      ? {
          type: scoreMatch[1],
          value: Number.parseInt(scoreMatch[2], 10),
        }
      : null;
    return {
      depth,
      multipv,
      nodes,
      nps,
      time,
      score,
      pv: pvMatch ? pvMatch[1].trim().split(/\s+/) : [],
    };
  }
  return null;
}

function numberToken(line, key) {
  const match = line.match(new RegExp(`\\b${key} (-?\\d+)`));
  return match ? Number.parseInt(match[1], 10) : 0;
}

function splitLines(data) {
  if (typeof data !== 'string') return [];
  return data.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError() {
  const error = new Error('Разбор отменён.');
  error.code = 'ABORTED';
  return error;
}
