import {
  detectSource,
  extractGame,
  gameFromPgn,
  mainlineMoveElements,
  shouldAutoOpen,
} from './extract.js';
import { loadSettings, subscribeToSettings } from '../shared/settings.js';
import { WhyChessPanel } from './panel.js';
import { BoardOverlay } from './board-overlay.js';

const api = globalThis.browser ?? globalThis.chrome;
const PORT_NAME = 'whychess';
const POLL_INTERVAL = 1600;
const MUTATION_DELAY = 700;

let settings = null;
let panel = null;
let overlay = null;
let port = null;
let analyzing = false;
let pageGame = null;
let activeGame = null;
let manualMode = false;
let currentUrl = navigationUrl();
let lastSource = null;
let disposed = false;
let refreshTimer = null;
let mutationTimer = null;
let heartbeatTimer = null;

async function init() {
  if (disposed) return;
  settings = await loadSettings();
  overlay = new BoardOverlay(detectSource());
  overlay.mount();
  lastSource = detectSource();

  panel = new WhyChessPanel({
    settings,
    onAnalyze: () => startAnalysis({ game: activeGame || pageGame }),
    onCancel: cancelAnalysis,
    onOpenSettings: openSettings,
    onManualAnalyze: analyzeManualPgn,
    onShowOnBoard: showOnBoard,
    onSelectMove: selectMoveOnSite,
    onUsePageGame: usePageGame,
    onOpen: () => refreshGame({ force: false }),
    onClose: () => overlay.hide(),
  });
  panel.mount();
  panel.setGame(null);
  refreshGame({ force: true });

  subscribeToSettings((next) => {
    settings = next;
    panel.setSettings(next);
    if (!next.showArrow) overlay.hide();
  });

  startObservers();
}

function startObservers() {
  window.setInterval(() => {
    if (disposed) return;
    checkUrl();
    if (!document.hidden) refreshGame();
  }, POLL_INTERVAL);

  window.addEventListener('popstate', checkUrl);
  window.addEventListener('hashchange', checkUrl);
  window.addEventListener('pagehide', () => {
    disposed = true;
    closePort();
  });

  if (globalThis.MutationObserver) {
    const observer = new MutationObserver(() => {
      if (disposed) return;
      clearTimeout(mutationTimer);
      mutationTimer = window.setTimeout(() => {
        if (!document.hidden) refreshGame();
      }, MUTATION_DELAY);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshGame();
  });
}

function refreshGame({ force = false } = {}) {
  if (disposed) return;
  const source = detectSource();
  if (source !== lastSource) {
    lastSource = source;
    overlay.setSource(source);
    panel?.setSite(source);
  }

  const next = extractGame(document, globalThis.location);
  if (!next) {
    if (pageGame) {
      pageGame = null;
      if (manualMode) {
        panel.setPageGameAvailable(false);
      } else if (!analyzing) {
        activeGame = null;
        overlay.hide();
        panel.setGame(null);
      }
    }
    return;
  }

  if (!force && pageGame?.signature === next.signature) {
    pageGame = next;
    const nextColor = next.userColor || null;
    const panelColor = panel?.getGameUserColor?.() ?? null;
    // The site may reveal or correct the player's side while a review is
    // already showing. Keep the panel aligned even if the colour arrived
    // together with a signature change during an analysis run.
    if (!manualMode && !analyzing && panelColor !== nextColor) {
      activeGame = next;
      panel?.setGameUserColor?.(nextColor);
    }
    if (manualMode) panel.setPageGameAvailable(Boolean(pageGame));
    return;
  }

  pageGame = next;

  // A manually pasted game is a separate review session. It must not be
  // replaced while the page below keeps changing (clocks, chat, move list).
  if (manualMode) {
    panel.setPageGameAvailable(true);
    return;
  }

  if (analyzing) return;

  activeGame = next;
  overlay.hide();
  panel.setGame(next, { pageGameAvailable: false });

  const auto = Boolean(settings?.autoOpen) && shouldAutoOpen(next, globalThis.location);
  if (auto) {
    panel.open({ focus: false });
    startAnalysis({ game: next });
  }
}

function syncPanelUserColor() {
  if (manualMode || !pageGame) return;
  panel?.setGameUserColor?.(pageGame.userColor || null);
}

function startAnalysis({ game } = {}) {
  const target = game || activeGame || pageGame;
  if (!target) {
    panel.open({ focus: true, userInitiated: true });
    panel.setManualError('Партия не найдена. Вставьте PGN вручную.');
    return;
  }
  if (target.error) {
    panel.open({ focus: false });
    panel.setError(target.error);
    return;
  }
  if (!target.pgn) {
    panel.open({ focus: false });
    panel.setError('Не удалось получить текст партии. Вставьте PGN вручную.');
    return;
  }

  activeGame = target;
  manualMode = target.source === 'manual';
  analyzing = true;
  overlay.hide();
  panel.setTab('review');
  panel.setPageGameAvailable(manualMode && Boolean(pageGame));
  panel.resetAnalysis();

  try {
    getPort().postMessage({
      type: 'analyze',
      payload: {
        pgn: target.pgn,
        settings: settings || {},
        userColor: panel?.getGameUserColor?.() || target.userColor || null,
        source: target.source,
        sourceLabel: target.sourceLabel,
        url: target.url,
      },
    });
    startHeartbeat(port);
  } catch (error) {
    analyzing = false;
    stopHeartbeat();
    closePort();
    panel.setError(`Не удалось связаться с фоновой частью расширения: ${error.message}`);
  }
}

function cancelAnalysis() {
  if (!analyzing) return;
  panel.setCancelling();
  try {
    port?.postMessage({ type: 'cancel' });
  } catch {
    // The port may already be gone; the disconnect handler reports it.
  }
}

function analyzeManualPgn(text) {
  const manual = gameFromPgn(text, globalThis.location);
  if (manual.error) {
    panel.setManualError(manual.error);
    return;
  }
  panel.setManualError(null);
  manualMode = true;
  activeGame = manual;
  panel.setGame(manual, { manual: true, pageGameAvailable: Boolean(pageGame) });
  panel.open({ focus: false });
  startAnalysis({ game: manual });
}

function usePageGame() {
  if (!pageGame) return;
  manualMode = false;
  activeGame = pageGame;
  overlay.setSource(pageGame.source);
  panel.setGame(pageGame, { manual: false });
  panel.setTab('review');
  panel.open({ focus: false });
}

function getPort() {
  if (port) return port;
  if (!api?.runtime?.connect) throw new Error('API расширения недоступно.');
  const thisPort = api.runtime.connect({ name: PORT_NAME });
  port = thisPort;
  thisPort.onMessage.addListener((message) => {
    if (port === thisPort) handleMessage(message);
  });
  thisPort.onDisconnect.addListener(() => {
    if (port !== thisPort) return;
    stopHeartbeat();
    port = null;
    if (analyzing) {
      analyzing = false;
      panel.setError('Связь с фоновой частью расширения прервалась. Обновите страницу и попробуйте снова.');
    }
  });
  return thisPort;
}

/**
 * Firefox keeps MV3 background scripts in an event page that is unloaded after
 * about 30 seconds without incoming events. A long Stockfish search can easily
 * take longer than that, so the content script sends a tiny ping while the
 * connection is alive. This keeps the analysis job (and its worker) running.
 */
function startHeartbeat(target) {
  stopHeartbeat();
  heartbeatTimer = window.setInterval(() => {
    if (port !== target) {
      stopHeartbeat();
      return;
    }
    try {
      target.postMessage({ type: 'ping' });
    } catch {
      stopHeartbeat();
    }
  }, 10000);
}

function stopHeartbeat() {
  if (heartbeatTimer === null) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function closePort() {
  stopHeartbeat();
  const current = port;
  port = null;
  if (!current) return;
  try {
    current.disconnect();
  } catch {
    // Already disconnected.
  }
}

function handleMessage(message) {
  if (!message || typeof message !== 'object') return;
  switch (message.type) {
    case 'started':
      if (!analyzing) return;
      panel.setStarted(message);
      break;
    case 'progress':
      if (!analyzing) return;
      panel.setProgress(message);
      break;
    case 'move':
      if (!analyzing) return;
      panel.addMove(message.move);
      break;
    case 'complete':
      analyzing = false;
      stopHeartbeat();
      panel.setAnalysis(message.analysis);
      syncPanelUserColor();
      if (message.analysis?.truncated) {
        panel.showToast('Партия разобрана не полностью: достигнут предел числа полуходов.', 'info');
      }
      break;
    case 'error':
      analyzing = false;
      stopHeartbeat();
      panel.setError(message.message);
      break;
    case 'cancelled':
      analyzing = false;
      stopHeartbeat();
      panel.setCancelled();
      break;
    default:
      break;
  }
}

async function showOnBoard(report) {
  if (!report?.bestMove?.from || !report?.bestMove?.to) return;
  if (!settings?.showArrow) {
    panel.showToast('Показ стрелки отключён в настройках.', 'info');
    return;
  }
  const game = activeGame;
  if (!game || game.source === 'manual') {
    panel.showToast('Для ручного разбора схема есть прямо в карточке хода.', 'info');
    return;
  }

  const synced = await syncBoardToPly(report.index, game.source);
  if (!synced) {
    panel.showToast('Не удалось перейти к этой позиции на доске. Смотрите схему в карточке хода.', 'info');
    return;
  }

  const shown = overlay.show({
    best: { from: report.bestMove.from, to: report.bestMove.to },
    played: report.isBest ? null : { from: report.from, to: report.to },
  });
  if (!shown) {
    panel.showToast('Доска не найдена на странице. Смотрите схему в карточке хода.', 'info');
    return;
  }
  panel.showToast('Стрелки показывают позицию перед этим ходом.', 'info');
}

async function selectMoveOnSite(report) {
  if (!report || !activeGame || activeGame.source === 'manual') return;
  const moves = mainlineMoveElements(document, activeGame.source);
  const target = moves[report.index];
  if (!target) return;
  target.scrollIntoView({ block: 'nearest' });
  clickElement(target);
  // The board now shows the played move, so arrows drawn for the position
  // before that move would point at the wrong squares.
  overlay.hide();
}

async function syncBoardToPly(index, source) {
  const moves = mainlineMoveElements(document, source);
  if (index <= 0) {
    const start = document.querySelector(
      'button[data-ply="0"], .jump[data-ply="0"], .jumps [data-ply="0"], .analyse__controls [data-ply="0"]',
    );
    if (start) {
      clickElement(start);
      await delay(280);
      return true;
    }
    if (!moves[0]) return false;
    clickElement(moves[0]);
    await delay(220);
    pressArrowLeft();
    await delay(320);
    return true;
  }

  const target = moves[index - 1];
  if (!target) return false;
  target.scrollIntoView({ block: 'nearest' });
  clickElement(target);
  await delay(340);
  return true;
}

/**
 * Sends the same sequence a real mouse produces. Lichess move nodes navigate
 * on pointerdown/pointerup (not click), the round replay listens for mousedown,
 * and Chess.com handles click. A plain synthetic click is therefore not enough.
 */
function clickElement(element) {
  const target = element.querySelector?.('.node-highlight-content') || element;
  const base = { bubbles: true, cancelable: true, view: window, button: 0 };
  const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  target.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }));
  target.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
  target.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }));
  target.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
  target.dispatchEvent(new MouseEvent('click', base));
}

function pressArrowLeft() {
  const dispatch = (target) => {
    if (!target) return;
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        code: 'ArrowLeft',
        keyCode: 37,
        which: 37,
        bubbles: true,
        cancelable: true,
      }),
    );
  };
  dispatch(document);
  dispatch(document.body);
}

/**
 * Lichess keeps the selected ply in the URL hash. Moving around the board must
 * not be treated as navigation to another page, otherwise the panel closes and
 * the analysis is thrown away right after a card click.
 */
function navigationUrl() {
  return String(globalThis.location?.href || '').split('#')[0];
}

function checkUrl() {
  if (disposed) return;
  const url = navigationUrl();
  if (url === currentUrl) return;
  currentUrl = url;
  manualMode = false;
  analyzing = false;
  pageGame = null;
  activeGame = null;
  overlay.hide();
  closePort();
  panel.setGame(null);
  panel.close();
  refreshGame({ force: true });
}

function openSettings() {
  try {
    const result = api?.runtime?.openOptionsPage?.();
    if (result?.catch) result.catch(() => {});
  } catch {
    panel.showToast('Не удалось открыть настройки расширения.', 'error');
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
