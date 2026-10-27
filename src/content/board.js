import { START_FEN } from '../shared/constants.js';

const FILES = 'abcdefgh';
const PIECE_GLYPHS = {
  p: '♟',
  n: '♞',
  b: '♝',
  r: '♜',
  q: '♛',
  k: '♚',
};

/** Returns 64 board cells ordered from rank 8 to rank 1, files a to h. */
export function parseFenBoard(fen = START_FEN) {
  const placement = String(fen).split(/\s+/)[0] || '';
  const rows = placement.split('/');
  const cells = [];
  for (let row = 0; row < 8; row += 1) {
    const rank = 8 - row;
    let file = 0;
    for (const char of rows[row] || '') {
      if (/\d/.test(char)) {
        const empty = Number(char);
        for (let index = 0; index < empty; index += 1) {
          cells.push(makeCell(file, rank, null));
          file += 1;
        }
      } else {
        const color = char === char.toUpperCase() ? 'w' : 'b';
        cells.push(makeCell(file, rank, { color, type: char.toLowerCase() }));
        file += 1;
      }
    }
    while (file < 8) {
      cells.push(makeCell(file, rank, null));
      file += 1;
    }
  }
  return cells;
}

function makeCell(fileIndex, rank, piece) {
  return {
    square: `${FILES[fileIndex]}${rank}`,
    file: fileIndex,
    rank,
    piece,
    light: (fileIndex + rank) % 2 === 0,
  };
}

/** Board coordinates in the 0..8 SVG space. */
export function squareCenter(square, orientation = 'w') {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return orientation === 'b'
    ? { x: 7.5 - file, y: rank - 0.5 }
    : { x: file + 0.5, y: 8.5 - rank };
}

function arrowGeometry(from, to, orientation) {
  const start = squareCenter(from, orientation);
  const end = squareCenter(to, orientation);
  if (!start || !end) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.01) return null;

  const ux = dx / length;
  const uy = dy / length;
  const startInset = 0.26;
  const endInset = 0.34;
  const x1 = start.x + ux * startInset;
  const y1 = start.y + uy * startInset;
  const x2 = end.x - ux * endInset;
  const y2 = end.y - uy * endInset;
  const head = 0.36;
  const wing = 0.19;
  const baseX = x2 - ux * head;
  const baseY = y2 - uy * head;

  return {
    line: { x1, y1, x2, y2 },
    head: [
      { x: x2, y: y2 },
      { x: baseX - uy * wing, y: baseY + ux * wing },
      { x: baseX + uy * wing, y: baseY - ux * wing },
    ],
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function appendArrow(svg, { from, to, kind = 'best', orientation = 'w' }) {
  const geometry = arrowGeometry(from, to, orientation);
  if (!geometry) return;
  const group = svgElement('g', { class: `arrow arrow--${kind}` });
  const outline = svgElement('line', {
    ...geometry.line,
    class: 'arrow__outline',
    'stroke-width': 0.32,
    'stroke-linecap': 'round',
  });
  const shaft = svgElement('line', {
    ...geometry.line,
    class: 'arrow__shaft',
    'stroke-width': 0.18,
    'stroke-linecap': 'round',
  });
  const headOutline = svgElement('polygon', {
    points: geometry.head.map((point) => `${point.x},${point.y}`).join(' '),
    class: 'arrow__head-outline',
  });
  const head = svgElement('polygon', {
    points: geometry.head.map((point) => `${point.x},${point.y}`).join(' '),
    class: 'arrow__head',
  });
  group.append(outline, shaft, headOutline, head);
  svg.appendChild(group);
}

export function createArrowSvg(arrows = [], orientation = 'w', className = '') {
  const svg = svgElement('svg', {
    viewBox: '0 0 8 8',
    preserveAspectRatio: 'none',
    class: `arrow-layer ${className}`.trim(),
    'aria-hidden': 'true',
    focusable: 'false',
  });
  for (const arrow of arrows) {
    appendArrow(svg, { ...arrow, orientation });
  }
  return svg;
}

/**
 * Static diagram used inside a move card. It always shows the position before
 * the move, so the recommendation can be studied without touching the site.
 */
export function createMiniBoard(report, options = {}) {
  const orientation = options.orientation || report.color || 'w';
  const wrapper = document.createElement('figure');
  wrapper.className = 'mini';

  const grid = document.createElement('div');
  grid.className = 'mini__grid';

  for (const cell of parseFenBoard(report.fenBefore)) {
    const square = document.createElement('div');
    square.className = `mini__square ${cell.light ? 'is-light' : 'is-dark'}`;
    if (cell.square === report.from || cell.square === report.to) {
      square.classList.add('is-from');
    }
    if (report.bestMove?.from === cell.square || report.bestMove?.to === cell.square) {
      square.classList.add('is-best');
    }
    if (cell.piece) {
      const glyph = document.createElement('span');
      glyph.className = `mini__piece is-${cell.piece.color}`;
      glyph.textContent = PIECE_GLYPHS[cell.piece.type];
      square.appendChild(glyph);
    }
    square.setAttribute('aria-label', cell.square);
    grid.appendChild(square);
  }

  const arrows = [];
  if (report.bestMove?.from && report.bestMove?.to) {
    arrows.push({ from: report.bestMove.from, to: report.bestMove.to, kind: 'best' });
  }
  if (
    !report.isBest &&
    report.from &&
    report.to &&
    (report.from !== report.bestMove?.from || report.to !== report.bestMove?.to)
  ) {
    arrows.push({ from: report.from, to: report.to, kind: 'played' });
  }

  const board = document.createElement('div');
  board.className = 'mini__board';
  board.appendChild(grid);
  board.appendChild(createArrowSvg(arrows, orientation, 'mini__arrows'));

  const caption = document.createElement('figcaption');
  caption.className = 'mini__caption';
  const side = orientation === 'b' ? 'чёрных' : 'белых';
  const kind = report.isBest ? 'сыгранный ход совпадает с лучшим' : 'золотая стрелка — лучший ход, красная — сыгранный';
  caption.textContent = `Позиция перед ходом, вид со стороны ${side}. На схеме: ${kind}.`;

  wrapper.append(board, caption);
  return wrapper;
}

export { PIECE_GLYPHS };
