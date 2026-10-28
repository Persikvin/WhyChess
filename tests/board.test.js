import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  arrowGeometry,
  createMiniBoard,
  miniBoardOrientation,
  orientBoardCells,
  parseFenBoard,
  squareCenter,
} from '../src/content/board.js';
import { START_FEN } from '../src/shared/constants.js';

function points(path) {
  return [...path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));
}

describe('arrowGeometry', () => {
  it('builds one closed silhouette per move', () => {
    const path = arrowGeometry('d2', 'd4', 'w');
    expect(path.startsWith('M ')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    expect(path).toContain('A ');
    expect(points(path).length).toBeGreaterThanOrEqual(8);
  });

  it('keeps the arrow inside the board', () => {
    for (const [from, to] of [
      ['d2', 'd4'],
      ['g1', 'f3'],
      ['a1', 'h8'],
      ['e4', 'd5'],
    ]) {
      const coords = points(arrowGeometry(from, to, 'w'));
      for (const { x, y } of coords) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(8);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(8);
      }
    }
  });

  it('starts near the origin square and stops before the target centre', () => {
    const from = squareCenter('e2', 'w');
    const to = squareCenter('e4', 'w');
    const coords = points(arrowGeometry('e2', 'e4', 'w'));
    const minY = Math.min(...coords.map((point) => point.y));
    const maxY = Math.max(...coords.map((point) => point.y));
    expect(minY).toBeGreaterThan(to.y);
    expect(maxY).toBeLessThan(from.y);
    expect(minY).toBeLessThan(to.y + 0.5);
    expect(maxY).toBeGreaterThan(from.y - 0.5);
  });

  it('mirrors the arrow for the black orientation', () => {
    const white = arrowGeometry('a1', 'h8', 'w');
    const black = arrowGeometry('a1', 'h8', 'b');
    const whitePoints = points(white);
    const blackPoints = points(black);
    expect(blackPoints).toHaveLength(whitePoints.length);
    for (let index = 0; index < whitePoints.length; index += 1) {
      expect(blackPoints[index].x).toBeCloseTo(8 - whitePoints[index].x, 2);
      expect(blackPoints[index].y).toBeCloseTo(8 - whitePoints[index].y, 2);
    }
  });

  it('ignores a move to the same square', () => {
    expect(arrowGeometry('e4', 'e4', 'w')).toBeNull();
    expect(arrowGeometry('bad', 'e4', 'w')).toBeNull();
  });
});

describe('orientBoardCells', () => {
  it('shows rank 8 at the top for white', () => {
    const cells = orientBoardCells(parseFenBoard(START_FEN), 'w');
    expect(cells[0]).toMatchObject({ square: 'a8', piece: { color: 'b', type: 'r' } });
    expect(cells[63]).toMatchObject({ square: 'h1', piece: { color: 'w', type: 'r' } });
  });

  it('rotates the whole board for black, not only the arrows', () => {
    const cells = orientBoardCells(parseFenBoard(START_FEN), 'b');
    expect(cells[0]).toMatchObject({ square: 'h1', piece: { color: 'w', type: 'r' } });
    expect(cells[7]).toMatchObject({ square: 'a1', piece: { color: 'w', type: 'r' } });
    expect(cells[56]).toMatchObject({ square: 'h8', piece: { color: 'b', type: 'r' } });
    expect(cells[63]).toMatchObject({ square: 'a8', piece: { color: 'b', type: 'r' } });
  });

  it('keeps the light and dark squares physically correct after rotation', () => {
    const cells = orientBoardCells(parseFenBoard(START_FEN), 'b');
    expect(cells[0]).toMatchObject({ square: 'h1', light: true });
    expect(cells[7]).toMatchObject({ square: 'a1', light: false });
  });

  it('renders a mini board from black side for a black move', () => {
    const { window } = new JSDOM('<!doctype html><html><body></body></html>');
    const previous = globalThis.document;
    globalThis.document = window.document;
    try {
      const figure = createMiniBoard({
        fenBefore: START_FEN,
        color: 'b',
        from: 'e7',
        to: 'e5',
        isBest: false,
        bestMove: { from: 'e7', to: 'e5' },
      });
      const squares = [...figure.querySelectorAll('.mini__square')];
      expect(squares).toHaveLength(64);
      expect(squares[0].getAttribute('aria-label')).toBe('h1');
      expect(squares[63].getAttribute('aria-label')).toBe('a8');
      expect(figure.querySelector('.mini__caption').textContent).toContain('со стороны чёрных');
    } finally {
      globalThis.document = previous;
    }
  });

  it('shows an opponent move from the reviewer side and keeps its arrows', () => {
    const { window } = new JSDOM('<!doctype html><html><body></body></html>');
    const previous = globalThis.document;
    globalThis.document = window.document;
    try {
      const figure = createMiniBoard(
        {
          fenBefore: START_FEN,
          color: 'b',
          from: 'g8',
          to: 'f6',
          isBest: false,
          bestMove: { from: 'e7', to: 'e5' },
        },
        { orientation: 'w' },
      );
      const squares = [...figure.querySelectorAll('.mini__square')];
      expect(squares[0].getAttribute('aria-label')).toBe('a8');
      expect(squares[63].getAttribute('aria-label')).toBe('h1');
      expect(figure.querySelector('.mini__caption').textContent).toContain('со стороны белых');
      expect(figure.querySelectorAll('.mini__arrows path')).toHaveLength(2);
    } finally {
      globalThis.document = previous;
    }
  });
});

describe('miniBoardOrientation', () => {
  it('keeps neighbour cards on the reviewer side', () => {
    expect(miniBoardOrientation({ color: 'b' }, 'w')).toBe('w');
    expect(miniBoardOrientation({ color: 'w' }, 'b')).toBe('b');
  });

  it('falls back to the mover when the reviewer side is unknown', () => {
    expect(miniBoardOrientation({ color: 'b' }, null)).toBe('b');
    expect(miniBoardOrientation({ color: 'w' }, null)).toBe('w');
  });
});
