// Geometry helpers for the movable and resizable WhyChess panel.

export const PANEL_MARGIN = 8;
export const PANEL_MIN_WIDTH = 320;
export const PANEL_MIN_HEIGHT = 240;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function sanitizeGeometry(value) {
  if (!value || typeof value !== 'object') return null;
  const x = finite(value.x);
  const y = finite(value.y);
  const width = finite(value.width);
  const height = finite(value.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export function geometryFromRect(rect) {
  if (!rect) return null;
  return sanitizeGeometry({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  });
}

// Keeps the panel fully inside the viewport when possible. On very small
// screens the minimum size shrinks to the available space instead of pushing
// the panel outside the window.
export function clampGeometry(value, viewport = {}, margin = PANEL_MARGIN) {
  const geometry = sanitizeGeometry(value);
  if (!geometry) return null;

  const viewportWidth = Math.max(1, finite(viewport.width) ?? 1024);
  const viewportHeight = Math.max(1, finite(viewport.height) ?? 768);
  const maxWidth = Math.max(1, viewportWidth - margin * 2);
  const maxHeight = Math.max(1, viewportHeight - margin * 2);
  const minWidth = Math.min(PANEL_MIN_WIDTH, maxWidth);
  const minHeight = Math.min(PANEL_MIN_HEIGHT, maxHeight);

  const width = Math.min(maxWidth, Math.max(minWidth, geometry.width));
  const height = Math.min(maxHeight, Math.max(minHeight, geometry.height));
  const maxX = Math.max(margin, viewportWidth - width - margin);
  const maxY = Math.max(margin, viewportHeight - height - margin);
  const x = Math.min(maxX, Math.max(margin, geometry.x));
  const y = Math.min(maxY, Math.max(margin, geometry.y));

  return { x, y, width, height };
}
