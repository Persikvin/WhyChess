import { describe, expect, it } from 'vitest';
import { arrowGeometry, squareCenter } from '../src/content/board.js';

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
