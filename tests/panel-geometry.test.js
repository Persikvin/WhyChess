import { describe, expect, it } from 'vitest';
import {
  PANEL_MARGIN,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  clampGeometry,
  geometryFromRect,
  sanitizeGeometry,
} from '../src/content/panel-geometry.js';

const VIEWPORT = { width: 1200, height: 900 };

describe('sanitizeGeometry', () => {
  it('accepts a complete geometry', () => {
    expect(sanitizeGeometry({ x: 10, y: 20, width: 400, height: 500 })).toEqual({
      x: 10,
      y: 20,
      width: 400,
      height: 500,
    });
  });

  it('rejects missing, non-finite and non-positive values', () => {
    expect(sanitizeGeometry(null)).toBeNull();
    expect(sanitizeGeometry({})).toBeNull();
    expect(sanitizeGeometry({ x: 0, y: 0, width: Number.NaN, height: 400 })).toBeNull();
    expect(sanitizeGeometry({ x: 0, y: 0, width: 0, height: 400 })).toBeNull();
    expect(sanitizeGeometry({ x: 0, y: 0, width: 400, height: -1 })).toBeNull();
  });
});

describe('geometryFromRect', () => {
  it('reads the visible box of a DOM rect', () => {
    expect(geometryFromRect({ left: 24, top: 32, width: 404, height: 600 })).toEqual({
      x: 24,
      y: 32,
      width: 404,
      height: 600,
    });
  });

  it('returns null for a missing rect', () => {
    expect(geometryFromRect(null)).toBeNull();
  });
});

describe('clampGeometry', () => {
  it('keeps a geometry that already fits', () => {
    const geometry = { x: 100, y: 80, width: 500, height: 700 };
    expect(clampGeometry(geometry, VIEWPORT)).toEqual(geometry);
  });

  it('pulls the panel away from the top-left edge', () => {
    const result = clampGeometry({ x: -120, y: -40, width: 400, height: 500 }, VIEWPORT);
    expect(result.x).toBe(PANEL_MARGIN);
    expect(result.y).toBe(PANEL_MARGIN);
  });

  it('pulls the panel away from the bottom-right edge', () => {
    const result = clampGeometry({ x: 5000, y: 5000, width: 400, height: 500 }, VIEWPORT);
    expect(result.x).toBe(VIEWPORT.width - 400 - PANEL_MARGIN);
    expect(result.y).toBe(VIEWPORT.height - 500 - PANEL_MARGIN);
  });

  it('enforces the minimum width and height', () => {
    const result = clampGeometry({ x: 100, y: 100, width: 120, height: 90 }, VIEWPORT);
    expect(result.width).toBe(PANEL_MIN_WIDTH);
    expect(result.height).toBe(PANEL_MIN_HEIGHT);
  });

  it('never grows beyond the viewport', () => {
    const result = clampGeometry({ x: 10, y: 10, width: 5000, height: 5000 }, VIEWPORT);
    expect(result.width).toBe(VIEWPORT.width - PANEL_MARGIN * 2);
    expect(result.height).toBe(VIEWPORT.height - PANEL_MARGIN * 2);
    expect(result.x).toBe(PANEL_MARGIN);
    expect(result.y).toBe(PANEL_MARGIN);
  });

  it('shrinks the minimum size on a small viewport', () => {
    const result = clampGeometry(
      { x: 30, y: 30, width: 100, height: 100 },
      { width: 300, height: 200 },
    );
    expect(result.width).toBe(300 - PANEL_MARGIN * 2);
    expect(result.height).toBe(200 - PANEL_MARGIN * 2);
    expect(result.x).toBe(PANEL_MARGIN);
    expect(result.y).toBe(PANEL_MARGIN);
  });

  it('returns null for invalid input', () => {
    expect(clampGeometry({ x: 0, y: 0, width: 0, height: 0 }, VIEWPORT)).toBeNull();
    expect(clampGeometry(undefined, VIEWPORT)).toBeNull();
  });
});
