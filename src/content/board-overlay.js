import { createArrowSvg } from './board.js';

const BOARD_SELECTORS = {
  chesscom: ['wc-chess-board', 'chess-board', '#board-single', '#board-play-computer'],
  lichess: ['cg-board', '.cg-wrap'],
};

const OVERLAY_CSS = `
:host {
  all: initial;
  position: fixed;
  z-index: 2147482000;
  pointer-events: none;
  display: block;
  width: 0;
  height: 0;
  overflow: visible;
  opacity: 0;
  transition: opacity 120ms ease;
}
:host([data-visible="true"]) { opacity: 1; }
* { box-sizing: border-box; }
.layer { position: absolute; inset: 0; width: 100%; height: 100%; }
.arrow__outline { stroke: rgba(8, 12, 20, 0.72); fill: none; }
.arrow__shaft { stroke: #f2c14e; fill: none; }
.arrow__head-outline { fill: rgba(8, 12, 20, 0.72); }
.arrow__head { fill: #f2c14e; }
.arrow--played .arrow__shaft { stroke: #ef6b6b; }
.arrow--played .arrow__head { fill: #ef6b6b; }
.legend {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 10px;
  padding: 5px 8px;
  border-radius: 8px;
  background: rgba(10, 16, 28, 0.86);
  color: #f4f6fb;
  font: 500 11px/1.2 "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.01em;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}
.legend span { display: inline-flex; align-items: center; gap: 5px; }
.dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }
.dot--best { background: #f2c14e; }
.dot--played { background: #ef6b6b; }
`;

export class BoardOverlay {
  constructor(source = null) {
    this.source = source;
    this.host = document.createElement('div');
    this.host.id = 'whychess-board-overlay';
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    shadow.appendChild(style);
    this.canvas = document.createElement('div');
    this.canvas.className = 'layer';
    shadow.appendChild(this.canvas);
    this.legend = document.createElement('div');
    this.legend.className = 'legend';
    this.legend.hidden = true;
    shadow.appendChild(this.legend);
    this.frame = null;
    this.board = null;
    this.lastRect = null;
    this.visible = false;
  }

  mount() {
    if (!this.host.isConnected) {
      (document.documentElement || document.body).appendChild(this.host);
    }
  }

  setSource(source) {
    this.source = source;
    this.board = null;
    this.hide();
  }

  findBoard() {
    if (this.board?.isConnected) return this.board;
    this.board = null;
    const selectors = BOARD_SELECTORS[this.source] || [
      ...BOARD_SELECTORS.chesscom,
      ...BOARD_SELECTORS.lichess,
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        this.board = element;
        break;
      }
    }
    return this.board;
  }

  orientation() {
    if (this.source === 'lichess') {
      const wrap = document.querySelector('.cg-wrap');
      return wrap?.classList.contains('orientation-black') ? 'b' : 'w';
    }
    const board = this.findBoard();
    return board?.classList.contains('flipped') ? 'b' : 'w';
  }

  show({ best, played = null } = {}) {
    if (!best?.from || !best?.to) return false;
    this.mount();
    this.findBoard();
    if (!this.board) return false;

    const arrows = [{ ...best, kind: 'best' }];
    if (played?.from && played?.to && (played.from !== best.from || played.to !== best.to)) {
      arrows.unshift({ ...played, kind: 'played' });
    }
    this.canvas.replaceChildren(createArrowSvg(arrows, this.orientation(), 'layer'));

    this.legend.hidden = arrows.length < 2;
    if (arrows.length > 1) {
      this.legend.replaceChildren(
        legendItem('best', 'лучший ход'),
        legendItem('played', 'сыгранный'),
      );
    }

    this.visible = true;
    this.host.dataset.visible = 'true';
    this.updatePosition();
    this.startLoop();
    return true;
  }

  hide() {
    this.visible = false;
    this.host.dataset.visible = 'false';
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  startLoop() {
    if (this.frame) return;
    const step = () => {
      if (!this.visible) {
        this.frame = null;
        return;
      }
      this.updatePosition();
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  updatePosition() {
    const board = this.findBoard();
    if (!board) {
      this.host.dataset.visible = 'false';
      return;
    }
    const rect = board.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80) {
      this.host.dataset.visible = 'false';
      return;
    }
    this.host.dataset.visible = 'true';
    const next = {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    const previous = this.lastRect;
    if (
      previous &&
      previous.left === next.left &&
      previous.top === next.top &&
      previous.width === next.width &&
      previous.height === next.height
    ) {
      return;
    }
    this.lastRect = next;
    this.host.style.left = `${next.left}px`;
    this.host.style.top = `${next.top}px`;
    this.host.style.width = `${next.width}px`;
    this.host.style.height = `${next.height}px`;
  }
}

function legendItem(kind, label) {
  const item = document.createElement('span');
  const dot = document.createElement('i');
  dot.className = `dot dot--${kind}`;
  item.append(dot, document.createTextNode(label));
  return item;
}

export function boardOrientation(doc = document, source = null) {
  if (source === 'lichess') {
    const wrap = doc.querySelector('.cg-wrap');
    return wrap?.classList.contains('orientation-black') ? 'b' : 'w';
  }
  if (source === 'chesscom') {
    const board = doc.querySelector('wc-chess-board, chess-board, #board-single');
    return board?.classList.contains('flipped') ? 'b' : 'w';
  }
  return 'w';
}
