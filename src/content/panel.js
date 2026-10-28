import { CLASSIFICATION_META, ERROR_CLASSIFICATIONS, SOURCE_LABELS } from '../shared/constants.js';
import { formatLoss } from '../shared/chess-utils.js';
import { createMiniBoard } from './board.js';
import { clampGeometry, geometryFromRect } from './panel-geometry.js';
import panelCss from './panel.css';

const CLASS_ORDER = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder', 'forced'];

const PANEL_HTML = `
<div class="panel" role="dialog" aria-label="WhyChess — разбор партии">
  <header class="header">
    <div class="brand">
      <span class="brand__mark" aria-hidden="true">♞</span>
      <div class="brand__text">
        <span class="brand__name">WhyChess</span>
        <span class="brand__tag">разбор партии</span>
      </div>
    </div>
    <div class="header__actions">
      <button class="icon-btn" type="button" data-action="settings" title="Настройки" aria-label="Настройки">⚙</button>
      <button class="icon-btn" type="button" data-action="close" title="Закрыть" aria-label="Закрыть">×</button>
    </div>
  </header>

  <nav class="tabs" role="tablist" aria-label="Разделы WhyChess">
    <button class="tab is-active" type="button" role="tab" aria-selected="true" data-tab="review">Разбор</button>
    <button class="tab" type="button" role="tab" aria-selected="false" data-tab="pgn">Вставить PGN</button>
  </nav>

  <div class="body">
    <section class="view" data-view="review" role="tabpanel">
      <div class="game" data-ref="game" hidden>
        <div class="game__top">
          <span class="game__source" data-ref="game-source"></span>
          <span class="game__result" data-ref="game-result"></span>
        </div>
        <div class="game__players" data-ref="game-players"></div>
        <div class="game__meta" data-ref="game-meta"></div>
        <div class="warning" data-ref="game-warning" hidden></div>
        <button class="link game__switch" type="button" data-action="use-page" data-ref="game-switch" hidden>Вернуться к партии со страницы</button>
      </div>

      <div class="empty" data-ref="empty" hidden>
        <div class="empty__icon" aria-hidden="true">♟</div>
        <div class="empty__title">Партия не найдена</div>
        <p class="empty__text">Откройте разбор завершённой партии на Chess.com или Lichess либо вставьте текст партии вручную.</p>
        <button class="btn btn--ghost" type="button" data-action="open-pgn">Вставить PGN</button>
      </div>

      <div class="controls" data-ref="controls" hidden>
        <button class="btn btn--primary" type="button" data-action="analyze" data-ref="analyze">Разобрать партию</button>
        <button class="btn btn--ghost" type="button" data-action="cancel" data-ref="cancel" hidden>Остановить</button>
      </div>

      <div class="progress" data-ref="progress" hidden>
        <div class="progress__labels">
          <span data-ref="progress-text">Подготовка…</span>
          <span class="progress__percent" data-ref="progress-percent">0%</span>
        </div>
        <div class="progress__track"><div class="progress__bar" data-ref="progress-bar"></div></div>
      </div>

      <div class="notice" data-ref="notice" hidden></div>

      <div class="summary" data-ref="summary" hidden>
        <div class="summary__title" data-ref="summary-title">Разбор завершён</div>
        <div class="summary__grid" data-ref="summary-grid"></div>
        <div class="summary__chips" data-ref="summary-chips"></div>
        <p class="summary__hint" data-ref="summary-hint"></p>
      </div>

      <div class="filters" data-ref="filters" hidden>
        <button class="chip is-active" type="button" data-filter="all">Все <span data-ref="count-all">0</span></button>
        <button class="chip" type="button" data-filter="user" data-ref="user-filter">Мои ходы <span data-ref="count-user">0</span></button>
        <button class="chip" type="button" data-filter="errors">Ошибки <span data-ref="count-errors">0</span></button>
      </div>

      <div class="moves" data-ref="moves"></div>
      <div class="empty empty--small" data-ref="filter-empty" hidden>
        <div class="empty__title">Ничего не найдено</div>
        <p class="empty__text">В этой партии нет ходов, подходящих под выбранный фильтр.</p>
      </div>
    </section>

    <section class="view" data-view="pgn" role="tabpanel" hidden>
      <p class="pgn__lead">Вставьте одну партию в формате PGN. Заголовки не обязательны: достаточно списка ходов, например <span class="mono">1. e4 e5 2. Nf3 Nc6</span>.</p>
      <label class="pgn__label" for="whychess-pgn">Текст партии</label>
      <textarea class="pgn__input" id="whychess-pgn" data-ref="pgn" spellcheck="false" placeholder="[Event &quot;Моя партия&quot;]&#10;&#10;1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *"></textarea>
      <div class="manual-error" data-ref="manual-error" hidden></div>
      <button class="btn btn--primary btn--wide" type="button" data-action="manual-analyze">Разобрать PGN</button>
      <p class="hint">Поддерживаются обычные шахматы. Текст партии и результаты расчёта остаются на вашем компьютере.</p>
    </section>
  </div>

  <footer class="footer">
    <span data-ref="footer-engine">Stockfish · глубина 10</span>
    <div class="footer__actions">
      <button class="link" type="button" data-action="reset-layout" title="Вернуть исходные положение и размер">Сбросить окно</button>
      <button class="link" type="button" data-action="settings">Настройки</button>
    </div>
  </footer>

  <div class="resizer" data-ref="resizer" role="separator" aria-label="Изменить размер окна" tabindex="0" title="Потяните, чтобы изменить размер">
    <span class="resizer__grip" aria-hidden="true"></span>
  </div>

  <div class="toast" data-ref="toast" role="status" hidden></div>
</div>
`;

const LAUNCHER_HTML = `
<button class="launcher" type="button" aria-label="Открыть WhyChess" title="WhyChess — разбор шахматной партии">
  <span class="launcher__mark" aria-hidden="true">♞</span>
  <span class="launcher__dot" data-ref="launcher-dot" hidden></span>
</button>
`;

export class WhyChessPanel {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.settings = callbacks.settings || { depth: 10 };
    this.state = {
      open: false,
      tab: 'review',
      game: null,
      manual: false,
      status: 'idle',
      filter: 'all',
      expanded: new Set(),
      moves: [],
      analysis: null,
    };
    this.cards = new Map();
    this.toastTimer = null;
    this.geometry = null;
    this.geometryTimer = null;
    this.geometryRestored = false;
    this.layoutReset = false;
    this.build();
  }

  build() {
    this.launcherHost = document.createElement('div');
    this.launcherHost.id = 'whychess-launcher-host';
    this.launcherHost.dataset.kind = 'launcher';
    this.launcherShadow = this.launcherHost.attachShadow({ mode: 'open' });
    applyShadowStyles(this.launcherShadow, panelCss);
    this.launcherShadow.innerHTML = LAUNCHER_HTML;
    this.launcher = this.launcherShadow.querySelector('.launcher');
    this.launcherDot = this.launcherShadow.querySelector('[data-ref="launcher-dot"]');
    this.launcher.addEventListener('click', () => {
      if (this.state.open) this.close();
      else this.open({ focus: true, userInitiated: true });
    });

    this.host = document.createElement('div');
    this.host.id = 'whychess-panel-host';
    this.host.dataset.kind = 'panel';
    this.host.dataset.open = 'false';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    applyShadowStyles(this.shadow, panelCss);
    this.shadow.innerHTML = PANEL_HTML;
    this.cacheRefs();

    this.shadow.addEventListener('click', (event) => this.handleClick(event));
    this.shadow.addEventListener('keydown', (event) => this.handleKeydown(event));
    this.$pgn.addEventListener('input', () => this.setManualError(null));
    this.setupLayout();

    this.render();
  }

  mount() {
    const parent = document.body || document.documentElement;
    if (!parent) return;
    if (!this.launcherHost.isConnected) parent.appendChild(this.launcherHost);
    if (!this.host.isConnected) parent.appendChild(this.host);
    this.restoreLayout();
  }

  setupLayout() {
    this.$header = this.shadow.querySelector('.header');
    this.$header?.addEventListener('pointerdown', (event) => this.handleDragStart(event));
    this.$resizer?.addEventListener('pointerdown', (event) => this.handleResizeStart(event));
    this.$resizer?.addEventListener('keydown', (event) => this.handleResizeKey(event));
    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('resize', () => {
        if (this.geometry) this.applyGeometry(clampGeometry(this.geometry, viewportSize()));
      });
    }
  }

  async restoreLayout() {
    if (this.geometryRestored) return;
    this.geometryRestored = true;
    const stored = await readPanelGeometry();
    if (this.geometry || this.layoutReset) return;
    const geometry = stored ? clampGeometry(stored, viewportSize()) : null;
    if (geometry) this.applyGeometry(geometry);
  }

  applyGeometry(geometry) {
    if (!this.host) return;
    this.geometry = geometry || null;
    if (!geometry) {
      this.host.dataset.geometry = 'auto';
      for (const property of ['left', 'top', 'right', 'width', 'height']) {
        this.host.style.removeProperty(property);
      }
      return;
    }
    this.host.dataset.geometry = 'custom';
    this.host.style.left = `${geometry.x}px`;
    this.host.style.top = `${geometry.y}px`;
    this.host.style.right = 'auto';
    this.host.style.width = `${geometry.width}px`;
    this.host.style.height = `${geometry.height}px`;
  }

  resetLayout() {
    clearTimeout(this.geometryTimer);
    this.geometryTimer = null;
    this.layoutReset = true;
    this.applyGeometry(null);
    clearPanelGeometry();
    this.showToast('Положение и размер окна сброшены.', 'info');
  }

  baseGeometry() {
    if (this.geometry) return { ...this.geometry };
    return geometryFromRect(this.host.getBoundingClientRect());
  }

  handleDragStart(event) {
    if (event.target.closest?.('button, a, input, textarea, select, [data-action]')) return;
    this.startPointerSession(event, 'drag');
  }

  handleResizeStart(event) {
    this.startPointerSession(event, 'resize');
  }

  startPointerSession(event, mode) {
    if (event.button !== undefined && event.button !== 0) return false;
    const start = this.baseGeometry();
    if (!start) return false;
    event.preventDefault();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    try {
      target.setPointerCapture?.(pointerId);
    } catch {
      // Pointer capture is an optimisation; dragging still works without it.
    }
    this.host.dataset.interacting = mode;

    const onMove = (moveEvent) => {
      const next = mode === 'drag'
        ? {
            ...start,
            x: start.x + moveEvent.clientX - startX,
            y: start.y + moveEvent.clientY - startY,
          }
        : {
            ...start,
            width: start.width + moveEvent.clientX - startX,
            height: start.height + moveEvent.clientY - startY,
          };
      const clamped = clampGeometry(next, viewportSize());
      if (clamped) this.applyGeometry(clamped);
    };

    const finish = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', finish);
      target.removeEventListener('pointercancel', finish);
      target.removeEventListener('lostpointercapture', finish);
      try {
        if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
      } catch {
        // The browser may have released the pointer already.
      }
      delete this.host.dataset.interacting;
      if (this.geometry) this.scheduleGeometrySave();
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', finish);
    target.addEventListener('pointercancel', finish);
    target.addEventListener('lostpointercapture', finish);
    return true;
  }

  handleResizeKey(event) {
    const step = event.shiftKey ? 64 : 16;
    const start = this.baseGeometry();
    if (!start) return;
    let next = null;
    if (event.key === 'ArrowRight') next = { ...start, width: start.width + step };
    else if (event.key === 'ArrowLeft') next = { ...start, width: start.width - step };
    else if (event.key === 'ArrowDown') next = { ...start, height: start.height + step };
    else if (event.key === 'ArrowUp') next = { ...start, height: start.height - step };
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    const clamped = clampGeometry(next, viewportSize());
    if (clamped) this.applyGeometry(clamped);
    this.scheduleGeometrySave();
  }

  scheduleGeometrySave() {
    clearTimeout(this.geometryTimer);
    this.geometryTimer = setTimeout(() => {
      this.geometryTimer = null;
      if (this.geometry) savePanelGeometry(this.geometry);
    }, 250);
  }

  cacheRefs() {
    const find = (ref) => this.shadow.querySelector(`[data-ref="${ref}"]`);
    this.$game = find('game');
    this.$gameSource = find('game-source');
    this.$gameResult = find('game-result');
    this.$gamePlayers = find('game-players');
    this.$gameMeta = find('game-meta');
    this.$gameWarning = find('game-warning');
    this.$gameSwitch = find('game-switch');
    this.$empty = find('empty');
    this.$controls = find('controls');
    this.$analyze = find('analyze');
    this.$cancel = find('cancel');
    this.$progress = find('progress');
    this.$progressText = find('progress-text');
    this.$progressPercent = find('progress-percent');
    this.$progressBar = find('progress-bar');
    this.$notice = find('notice');
    this.$summary = find('summary');
    this.$summaryTitle = find('summary-title');
    this.$summaryGrid = find('summary-grid');
    this.$summaryChips = find('summary-chips');
    this.$summaryHint = find('summary-hint');
    this.$filters = find('filters');
    this.$userFilter = find('user-filter');
    this.$countAll = find('count-all');
    this.$countUser = find('count-user');
    this.$countErrors = find('count-errors');
    this.$moves = find('moves');
    this.$filterEmpty = find('filter-empty');
    this.$pgn = find('pgn');
    this.$manualError = find('manual-error');
    this.$footerEngine = find('footer-engine');
    this.$resizer = find('resizer');
    this.$toast = find('toast');
    this.$tabs = Array.from(this.shadow.querySelectorAll('[data-tab]'));
    this.$views = Array.from(this.shadow.querySelectorAll('[data-view]'));
    this.$filtersButtons = Array.from(this.shadow.querySelectorAll('[data-filter]'));
  }

  handleClick(event) {
    const actionTarget = event.target.closest('[data-action]');
    if (actionTarget) {
      const action = actionTarget.dataset.action;
      if (action === 'close') {
        this.close();
        return;
      }
      if (action === 'settings') {
        this.callbacks.onOpenSettings?.();
        return;
      }
      if (action === 'reset-layout') {
        this.resetLayout();
        return;
      }
      if (action === 'open-pgn') {
        this.setTab('pgn', { focus: true });
        return;
      }
      if (action === 'analyze') {
        this.callbacks.onAnalyze?.();
        return;
      }
      if (action === 'cancel') {
        this.callbacks.onCancel?.();
        return;
      }
      if (action === 'manual-analyze') {
        this.submitManual();
        return;
      }
      if (action === 'use-page') {
        this.callbacks.onUsePageGame?.();
        return;
      }
      if (action === 'board') {
        const card = actionTarget.closest('[data-index]');
        const report = this.cardReport(card);
        if (report) this.callbacks.onShowOnBoard?.(report);
        return;
      }
      if (action === 'toggle') {
        const card = actionTarget.closest('[data-index]');
        if (card) {
          const index = Number(card.dataset.index);
          const wasOpen = this.state.expanded.has(index);
          this.toggleCard(index);
          if (!wasOpen) {
            this.callbacks.onSelectMove?.(this.cards.get(index)?.report);
          }
        }
        return;
      }
    }

    const tab = event.target.closest('[data-tab]');
    if (tab) {
      this.setTab(tab.dataset.tab, { focus: false });
      return;
    }

    const filter = event.target.closest('[data-filter]');
    if (filter) {
      this.setFilter(filter.dataset.filter);
    }
  }

  handleKeydown(event) {
    if (event.key !== 'Escape' || !this.state.open) return;
    this.close();
  }

  submitManual() {
    const value = this.$pgn.value.trim();
    if (!value) {
      this.setManualError('Вставьте текст партии в формате PGN.');
      this.$pgn.focus();
      return;
    }
    this.setManualError(null);
    this.callbacks.onManualAnalyze?.(value);
  }

  open({ focus = false, userInitiated = false } = {}) {
    if (!this.state.open) {
      this.state.open = true;
      this.host.dataset.open = 'true';
      this.callbacks.onOpen?.();
      if (!this.state.game) this.setTab('pgn', { focus: false });
    }
    if (focus) {
      const target = this.state.tab === 'pgn' ? this.$pgn : this.shadow.querySelector('[data-action="close"]');
      target?.focus({ preventScroll: true });
    }
    if (userInitiated && !this.state.game) this.setTab('pgn', { focus: true });
  }

  close() {
    if (!this.state.open) return;
    this.state.open = false;
    this.host.dataset.open = 'false';
    this.callbacks.onClose?.();
  }

  isOpen() {
    return this.state.open;
  }

  setTab(tab, { focus = false } = {}) {
    if (tab !== 'review' && tab !== 'pgn') return;
    this.state.tab = tab;
    for (const button of this.$tabs) {
      const active = button.dataset.tab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    }
    for (const view of this.$views) {
      view.hidden = view.dataset.view !== tab;
    }
    if (focus) {
      if (tab === 'pgn') this.$pgn.focus({ preventScroll: true });
      else this.shadow.querySelector('[data-action="analyze"]')?.focus({ preventScroll: true });
    }
  }

  setSettings(settings) {
    this.settings = settings || this.settings;
    this.$footerEngine.textContent = `Stockfish · глубина ${this.settings.depth}`;
    if (this.state.analysis) this.renderSummary(this.state.analysis);
  }

  setGame(game, { manual = false, pageGameAvailable = false } = {}) {
    this.state.game = game || null;
    this.state.manual = Boolean(manual);
    this.state.pageGameAvailable = Boolean(pageGameAvailable);
    this.state.status = 'idle';
    this.state.moves = [];
    this.state.analysis = null;
    this.state.expanded = new Set();
    this.state.filter = 'all';
    this.cards.clear();
    this.$moves.replaceChildren();
    this.$summary.hidden = true;
    this.$filters.hidden = true;
    this.$filterEmpty.hidden = true;
    this.$notice.hidden = true;
    this.$progress.hidden = true;
    this.$manualError.hidden = true;
    this.setManualError(null);
    this.launcherDot.hidden = !game || Boolean(game.error);
    this.render();
    if (this.state.open && !game) this.setTab('pgn', { focus: false });
    if (this.state.open && game) this.setTab('review', { focus: false });
  }

  render() {
    const game = this.state.game;
    const hasPlayableGame = Boolean(game && !game.error);
    this.$game.hidden = !game;
    this.$empty.hidden = Boolean(game);
    this.$controls.hidden = !hasPlayableGame;
    this.$analyze.disabled = !hasPlayableGame;
    this.$analyze.textContent = this.state.analysis ? 'Разобрать заново' : 'Разобрать партию';
    this.$cancel.hidden = this.state.status !== 'analyzing';

    if (!game) {
      this.$gameWarning.hidden = true;
      this.updateCounts();
      return;
    }

    const source = game.sourceLabel || SOURCE_LABELS[game.source] || 'PGN';
    this.$gameSource.textContent = this.state.manual ? `${source} · ручной разбор` : source;
    this.$gameResult.textContent = game.result && game.result !== '*' ? game.result : '';
    this.$gamePlayers.textContent = `${game.white || 'Белые'} — ${game.black || 'Чёрные'}`;
    const pieces = [
      plural(game.totalMoves || 0, 'ход', 'хода', 'ходов'),
      `глубина ${this.settings.depth}`,
      game.pageKind === 'analysis' ? 'страница анализа' : null,
    ].filter(Boolean);
    this.$gameMeta.textContent = pieces.join(' · ');

    let warning = '';
    if (game.error) warning = game.error;
    else if (game.unsupported) warning = 'Этот вариант шахмат пока не поддерживается.';
    else if (game.ongoing) warning = 'Партия ещё идёт. Список ходов может измениться, поэтому автоматический разбор не запускается.';
    this.$gameWarning.hidden = !warning;
    this.$gameWarning.textContent = warning;
    this.$gameSwitch.hidden = !(this.state.manual && this.state.pageGameAvailable);
    this.updateCounts();
  }

  setPageGameAvailable(available) {
    this.state.pageGameAvailable = Boolean(available);
    this.$gameSwitch.hidden = !(this.state.manual && this.state.pageGameAvailable);
  }

  resetAnalysis() {
    this.state.status = 'analyzing';
    this.state.moves = [];
    this.state.analysis = null;
    this.state.expanded = new Set();
    this.state.filter = 'all';
    this.cards.clear();
    this.$moves.replaceChildren();
    this.$summary.hidden = true;
    this.$filters.hidden = true;
    this.$filterEmpty.hidden = true;
    this.$notice.hidden = true;
    this.$progress.hidden = false;
    this.$controls.hidden = false;
    this.$analyze.disabled = true;
    this.$analyze.textContent = 'Разбор…';
    this.$cancel.hidden = false;
    this.$cancel.disabled = false;
    this.$cancel.textContent = 'Остановить';
    this.setProgressBar(0, 0);
    this.$progressText.textContent = 'Запуск движка…';
    this.updateCounts();
  }

  setCancelling() {
    this.$cancel.disabled = true;
    this.$cancel.textContent = 'Останавливаем…';
  }

  setStarted(message) {
    this.state.status = 'analyzing';
    this.$notice.hidden = true;
    this.$summary.hidden = true;
    this.$filters.hidden = true;
    this.$progress.hidden = false;
    this.$controls.hidden = false;
    this.$analyze.disabled = true;
    this.$cancel.hidden = false;
    this.$cancel.disabled = false;
    const total = message.total || 0;
    this.setProgressBar(0, total);
    if (message.white || message.black) {
      this.$gamePlayers.textContent = `${message.white || 'Белые'} — ${message.black || 'Чёрные'}`;
    }
    if (message.totalMoves) {
      this.$gameMeta.textContent = `${plural(message.totalMoves, 'ход', 'хода', 'ходов')} · глубина ${this.settings.depth}`;
    }
    if (message.truncated) {
      this.showToast(`Партия длиннее лимита: будут разобраны первые ${message.analyzedMoves} полуходов.`, 'info');
    }
  }

  setProgress(message) {
    const total = message.total || this.state.progressTotal || 0;
    this.state.progressTotal = total;
    this.setProgressBar(message.done || 0, total);
    if (message.terminal === 'checkmate') {
      this.$progressText.textContent = 'Достигнута позиция мата.';
    }
  }

  setProgressBar(done, total) {
    const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    this.$progressBar.style.width = `${percent}%`;
    this.$progressPercent.textContent = `${percent}%`;
    this.$progressText.textContent = total > 0 ? `Анализ позиций: ${done} из ${total}` : 'Подготовка движка…';
  }

  addMove(report) {
    this.state.moves.push(report);
    this.state.status = 'analyzing';
    this.appendCard(report);
    this.updateCounts();
  }

  setAnalysis(analysis) {
    this.state.analysis = analysis;
    this.state.status = 'complete';
    this.state.moves = [...(analysis.moves || [])];
    const expanded = new Set(this.state.expanded);
    this.state.expanded = new Set();
    this.cards.clear();
    this.$moves.replaceChildren();
    for (const move of this.state.moves) this.appendCard(move, { expanded: expanded.has(move.index) });

    if (![...this.state.expanded].length) {
      const firstError = this.state.moves.find((move) => ERROR_CLASSIFICATIONS.includes(move.classification));
      if (firstError) this.toggleCard(firstError.index, { silent: true });
    }

    this.$progress.hidden = true;
    this.$notice.hidden = true;
    this.$controls.hidden = false;
    this.$analyze.disabled = false;
    this.$analyze.textContent = 'Разобрать заново';
    this.$cancel.hidden = true;
    this.$summary.hidden = false;
    this.$filters.hidden = this.state.moves.length === 0;
    this.renderSummary(analysis);
    this.updateCounts();
    this.applyFilter();
    if (analysis.game) {
      this.$gamePlayers.textContent = `${analysis.game.white || 'Белые'} — ${analysis.game.black || 'Чёрные'}`;
    }
  }

  setError(message) {
    this.state.status = 'error';
    this.$progress.hidden = true;
    this.$cancel.hidden = true;
    this.$controls.hidden = false;
    this.$analyze.disabled = !this.state.game || Boolean(this.state.game.error);
    this.$analyze.textContent = 'Попробовать снова';
    this.$notice.hidden = false;
    this.$notice.className = 'notice notice--error';
    this.$notice.textContent = message || 'Не удалось выполнить разбор партии.';
    this.$summary.hidden = true;
    this.showToast(message || 'Не удалось выполнить разбор.', 'error');
  }

  setCancelled() {
    this.state.status = 'cancelled';
    this.$progress.hidden = true;
    this.$cancel.hidden = true;
    this.$controls.hidden = false;
    this.$analyze.disabled = !this.state.game || Boolean(this.state.game.error);
    this.$analyze.textContent = 'Разобрать заново';
    this.$notice.hidden = false;
    this.$notice.className = 'notice notice--info';
    this.$notice.textContent = this.state.moves.length
      ? 'Разбор остановлен. Уже готовые ходы остались в списке.'
      : 'Разбор остановлен.';
    this.$filters.hidden = this.state.moves.length === 0;
  }

  setManualError(message) {
    if (!message) {
      this.$manualError.hidden = true;
      this.$manualError.textContent = '';
      return;
    }
    this.$manualError.hidden = false;
    this.$manualError.textContent = message;
  }

  setFilter(filter) {
    if (filter === 'user' && !this.state.game?.userColor) return;
    this.state.filter = filter;
    for (const button of this.$filtersButtons) {
      button.classList.toggle('is-active', button.dataset.filter === filter);
    }
    this.applyFilter();
  }

  applyFilter() {
    if (!this.cards.size) {
      this.$filterEmpty.hidden = true;
      return;
    }
    let visible = 0;
    for (const [index, entry] of this.cards) {
      const show = matchesFilter(entry.report, this.state.filter);
      entry.card.hidden = !show;
      if (show) visible += 1;
      if (!show && this.state.expanded.has(index)) {
        // Keep the card expanded, but it stays hidden until the filter changes.
      }
    }
    this.$filterEmpty.hidden = visible > 0;
  }

  toggleCard(index, { silent = false } = {}) {
    const entry = this.cards.get(index);
    if (!entry) return;
    const isOpen = this.state.expanded.has(index);
    if (isOpen) this.state.expanded.delete(index);
    else this.state.expanded.add(index);
    entry.body.hidden = isOpen;
    entry.head.setAttribute('aria-expanded', String(!isOpen));
    entry.card.classList.toggle('is-open', !isOpen);
    if (!isOpen && !entry.filled) {
      this.fillCard(entry);
      entry.filled = true;
    }
    if (!silent && !isOpen) {
      entry.head.focus?.({ preventScroll: true });
    }
  }

  appendCard(report, { expanded = false } = {}) {
    const card = document.createElement('article');
    card.className = `move-card tone-${report.tone || 'good'}${report.isUser ? ' is-user' : ''}`;
    card.dataset.index = String(report.index);
    if (expanded) card.classList.add('is-open');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'move-card__head';
    head.dataset.action = 'toggle';
    head.setAttribute('aria-expanded', String(expanded));
    head.setAttribute('aria-controls', `whychess-move-${report.index}`);

    const number = span('move-card__number', `${report.moveNumber}${report.color === 'w' ? '.' : '…'}`);
    const san = span('move-card__san', report.san);
    const badge = span(`badge badge--${report.tone || 'good'}`, report.label || '');
    const evalText = span(`move-card__eval ${evalTone(report.playedEval?.evalText)}`, report.playedEval?.evalText || '');
    const chevron = span('move-card__chevron', '›');
    chevron.setAttribute('aria-hidden', 'true');
    head.append(number, san, badge, evalText, chevron);

    const body = document.createElement('div');
    body.className = 'move-card__body';
    body.id = `whychess-move-${report.index}`;
    body.hidden = !expanded;

    card.append(head, body);
    this.$moves.appendChild(card);

    const entry = { card, head, body, report, filled: false };
    this.cards.set(report.index, entry);
    if (expanded) this.state.expanded.add(report.index);
    if (expanded) {
      this.fillCard(entry);
      entry.filled = true;
    }
  }

  fillCard(entry) {
    const { report, body } = entry;
    body.replaceChildren();

    if (report.bestMove?.san) {
      const best = document.createElement('div');
      best.className = 'best-line';
      const label = span('best-line__label', 'Лучший ход');
      const move = span('best-line__move', report.bestMove.san);
      const evaluation = span(`best-line__eval ${evalTone(report.bestMove.evalText)}`, report.bestMove.evalText || '');
      best.append(label, move, evaluation);
      body.appendChild(best);

      const loss = document.createElement('div');
      loss.className = 'loss-line';
      loss.textContent = report.lossCp > 0
        ? `Потеря относительно лучшего хода: ${formatLoss(report.lossCp)}.`
        : 'Потеря относительно лучшего хода отсутствует.';
      body.appendChild(loss);

      if (report.bestMove.pvSan?.length > 1) {
        const pv = document.createElement('div');
        pv.className = 'variant';
        pv.textContent = `Вариант движка: ${report.bestMove.pvSan.slice(0, 8).join(' ')}`;
        body.appendChild(pv);
      }
    }

    if (report.refutation?.san) {
      const refutation = document.createElement('div');
      refutation.className = 'refutation';
      const line = report.refutation.pvSan?.length > 1
        ? ` (${report.refutation.pvSan.slice(0, 6).join(' ')})`
        : '';
      refutation.textContent = `Соперник мог ответить: ${report.refutation.san}${line}`;
      body.appendChild(refutation);
    }

    if (Array.isArray(report.explanation) && report.explanation.length > 0) {
      const explanation = document.createElement('div');
      explanation.className = 'explanation';
      for (const paragraph of report.explanation) {
        const p = document.createElement('p');
        p.textContent = paragraph;
        explanation.appendChild(p);
      }
      body.appendChild(explanation);
    }

    if (report.fenBefore) {
      body.appendChild(createMiniBoard(report, { orientation: report.color }));
    }

    if (this.callbacks.onShowOnBoard && !this.state.manual && report.bestMove?.san && report.index >= 0) {
      const actions = document.createElement('div');
      actions.className = 'card-actions';
      const boardButton = document.createElement('button');
      boardButton.type = 'button';
      boardButton.className = 'btn btn--ghost btn--small';
      boardButton.dataset.action = 'board';
      boardButton.textContent = 'Показать на доске';
      actions.appendChild(boardButton);
      body.appendChild(actions);
    }
  }

  renderSummary(analysis) {
    const summary = analysis.summary;
    if (!summary) return;
    const userColor = summary.userColor;
    const counts = userColor ? summary.userCounts : summary.counts;
    const errors = userColor ? summary.userErrorCount : summary.errorCount;
    const avgLoss = userColor ? summary.userAvgLoss : summary.avgLoss;

    this.$summaryTitle.textContent = summary.truncated ? 'Разбор завершён частично' : 'Разбор завершён';
    this.$summaryGrid.replaceChildren(
      metric(String(summary.analyzedMoves), summary.analyzedMoves === 1 ? 'ход разобран' : 'ходов разобрано'),
      metric(String(errors), errors === 1 ? 'ошибка' : 'ошибок'),
      metric(formatAverageLoss(avgLoss), 'средняя потеря'),
    );

    this.$summaryChips.replaceChildren();
    for (const key of CLASS_ORDER) {
      const count = counts[key] || 0;
      if (!count) continue;
      const chip = span(`badge badge--${CLASSIFICATION_META[key]?.tone || key}`, `${CLASSIFICATION_META[key]?.label || key}: ${count}`);
      this.$summaryChips.appendChild(chip);
    }

    const hintParts = [];
    hintParts.push(userColor ? 'Счётчики относятся к вашим ходам; ходы соперника тоже доступны в списке.' : 'Показаны ходы обеих сторон.');
    if (summary.truncated) hintParts.push(`Разобраны первые ${summary.analyzedMoves} полуходов из ${summary.totalMoves}.`);
    hintParts.push(`Глубина расчёта: ${summary.depth}.`);
    this.$summaryHint.textContent = hintParts.join(' ');
  }

  updateCounts() {
    const moves = this.state.moves;
    const userColor = this.state.game?.userColor;
    const userMoves = moves.filter((move) => move.isUser);
    const errors = moves.filter((move) => ERROR_CLASSIFICATIONS.includes(move.classification));
    this.$countAll.textContent = String(moves.length);
    this.$countUser.textContent = String(userMoves.length);
    this.$countErrors.textContent = String(errors.length);
    this.$userFilter.hidden = !userColor;
    if (!userColor && this.state.filter === 'user') {
      this.state.filter = 'all';
      for (const button of this.$filtersButtons) {
        button.classList.toggle('is-active', button.dataset.filter === 'all');
      }
    }
  }

  showToast(message, tone = 'info') {
    if (!message) return;
    clearTimeout(this.toastTimer);
    this.$toast.hidden = false;
    this.$toast.className = `toast toast--${tone}`;
    this.$toast.textContent = message;
    this.toastTimer = setTimeout(() => {
      this.$toast.hidden = true;
    }, 4500);
  }

  cardReport(card) {
    if (!card) return null;
    return this.cards.get(Number(card.dataset.index))?.report || null;
  }
}

function applyShadowStyles(root, css) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = css;
    root.appendChild(style);
  }
}

const PANEL_GEOMETRY_KEY = 'panelGeometry';

function viewportSize() {
  const doc = globalThis.document;
  return {
    width: Number(globalThis.innerWidth) || doc?.documentElement?.clientWidth || 1024,
    height: Number(globalThis.innerHeight) || doc?.documentElement?.clientHeight || 768,
  };
}

function panelStorage() {
  const api = globalThis.browser ?? globalThis.chrome;
  return api?.storage?.local ?? null;
}

async function readPanelGeometry() {
  const area = panelStorage();
  if (!area) return null;
  try {
    const stored = await area.get(PANEL_GEOMETRY_KEY);
    return stored?.[PANEL_GEOMETRY_KEY] ?? null;
  } catch {
    return null;
  }
}

async function savePanelGeometry(geometry) {
  const area = panelStorage();
  if (!area || !geometry) return;
  try {
    await area.set({ [PANEL_GEOMETRY_KEY]: geometry });
  } catch {
    // The panel keeps working for this page even when storage is unavailable.
  }
}

async function clearPanelGeometry() {
  const area = panelStorage();
  if (!area) return;
  try {
    await area.remove(PANEL_GEOMETRY_KEY);
  } catch {
    // Ignore storage errors: the visual reset has already happened.
  }
}

function span(className, text) {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

function metric(value, label) {
  const wrapper = document.createElement('div');
  wrapper.className = 'metric';
  wrapper.append(span('metric__value', value), span('metric__label', label));
  return wrapper;
}

function matchesFilter(report, filter) {
  if (filter === 'user') return Boolean(report.isUser);
  if (filter === 'errors') return ERROR_CLASSIFICATIONS.includes(report.classification);
  return true;
}

function evalTone(text) {
  if (!text) return '';
  if (text.startsWith('+')) return 'is-positive';
  if (text.startsWith('−') || text.startsWith('-')) return 'is-negative';
  return 'is-neutral';
}

function formatAverageLoss(cp) {
  if (!Number.isFinite(cp)) return '—';
  if (cp >= 100000) return 'мат';
  return `${(cp / 100).toFixed(2).replace('.', ',')} пешки`;
}

export function plural(count, one, few, many) {
  const value = Math.abs(Number(count) || 0);
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${value} ${few}`;
  return `${value} ${many}`;
}
