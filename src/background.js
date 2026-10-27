import { UciEngine } from './background/uci-engine.js';
import { analyzeGame } from './background/analyzer.js';
import { sanitizeSettings } from './shared/settings.js';

const api = globalThis.browser ?? globalThis.chrome;
const PORT_NAME = 'whychess';
const MAX_PGN_LENGTH = 250_000;

let engine = null;
let currentJob = null;
let startSerial = Promise.resolve();

function getEngine() {
  if (!engine) {
    engine = new UciEngine({
      workerUrl: api.runtime.getURL('stockfish.asm.js'),
    });
  }
  return engine;
}

function postTo(port, message) {
  try {
    port.postMessage(message);
  } catch {
    // The tab may have been closed while the calculation was running.
  }
}

api.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;

  let disconnected = false;
  let cancelPending = false;

  port.onDisconnect.addListener(() => {
    disconnected = true;
    if (currentJob?.port === port) {
      currentJob.cancelled = true;
      getEngine().cancel().catch(() => {});
    }
  });

  port.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ping') {
      postTo(port, { type: 'pong' });
      return;
    }
    if (message.type === 'cancel') {
      if (currentJob?.port === port) {
        currentJob.userCancelled = true;
        currentJob.cancelled = true;
        getEngine().cancel().catch(() => {});
      } else {
        // The analysis request may still be waiting in the queue.
        cancelPending = true;
      }
      return;
    }
    if (message.type !== 'analyze') return;

    if (cancelPending) {
      cancelPending = false;
      postTo(port, { type: 'cancelled', message: 'Разбор отменён.' });
      return;
    }

    const payload = message.payload || {};
    if (typeof payload.pgn !== 'string' || !payload.pgn.trim()) {
      postTo(port, { type: 'error', message: 'Не передан текст партии.', code: 'EMPTY_PGN' });
      return;
    }
    if (payload.pgn.length > MAX_PGN_LENGTH) {
      postTo(port, {
        type: 'error',
        message: 'Текст партии слишком большой. Вставьте только одну партию.',
        code: 'PGN_TOO_LARGE',
      });
      return;
    }

    const settings = sanitizeSettings(payload.settings || {});
    const request = {
      port,
      pgn: payload.pgn,
      settings,
      userColor: payload.userColor === 'w' || payload.userColor === 'b' ? payload.userColor : null,
      meta: {
        source: typeof payload.source === 'string' ? payload.source : null,
        sourceLabel: typeof payload.sourceLabel === 'string' ? payload.sourceLabel : null,
        url: typeof payload.url === 'string' ? payload.url : null,
      },
    };

    startSerial = startSerial
      .then(() => launchJob(request, () => disconnected))
      .catch((error) => {
        postTo(port, {
          type: 'error',
          message: friendlyError(error),
          code: error?.code || 'INTERNAL_ERROR',
        });
      });
  });
});

async function launchJob(request, isDisconnected) {
  const previous = currentJob;
  if (previous) {
    previous.cancelled = true;
    if (engine) await engine.cancel().catch(() => {});
    await previous.done?.catch(() => {});
  }

  const job = {
    id: Date.now() + Math.random(),
    port: request.port,
    cancelled: false,
    userCancelled: false,
    done: null,
  };
  currentJob = job;
  const emit = (message) => {
    if (job.cancelled || isDisconnected()) return;
    postTo(job.port, message);
  };

  job.done = (async () => {
    try {
      const activeEngine = getEngine();
      await analyzeGame({
        pgn: request.pgn,
        depth: request.settings.depth,
        maxPlies: request.settings.maxPlies,
        userColor: request.userColor,
        meta: request.meta,
        engine: activeEngine,
        emit,
        isCancelled: () => job.cancelled || isDisconnected(),
      });
    } catch (error) {
      if (job.cancelled || error?.code === 'ABORTED') {
        // `emit` is muted for a cancelled job, so confirm the cancellation
        // directly. A superseded job (a new analysis replaced this one) must
        // stay silent: the panel is already waiting for the new result.
        if (job.userCancelled && !isDisconnected()) {
          postTo(job.port, { type: 'cancelled', message: 'Разбор отменён.' });
        }
        return;
      }
      if (engine?.fatalError) {
        engine.destroy();
        engine = null;
      }
      emit({
        type: 'error',
        message: friendlyError(error),
        code: error?.code || 'ANALYSIS_ERROR',
      });
    } finally {
      if (currentJob === job) currentJob = null;
    }
  })();
}

function friendlyError(error) {
  if (!error) return 'Не удалось выполнить разбор партии.';
  if (error.code === 'INVALID_PGN' || error.code === 'EMPTY_PGN' || error.code === 'UNSUPPORTED_VARIANT') {
    return error.message;
  }
  if (error.code === 'PGN_TOO_LARGE') return error.message;
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith('Не ') || message.startsWith('Ошибка') || message.startsWith('Расчёт')
    ? message
    : `Не удалось выполнить разбор: ${message}`;
}
