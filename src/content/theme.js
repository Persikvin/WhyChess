const DARK_TOKENS = new Set(['dark', 'night', 'dim']);
const LIGHT_TOKENS = new Set(['light', 'day']);
const AMBIGUOUS_VALUES = new Set(['auto', 'system', 'default', 'inherit', 'normal']);

const THEME_ATTRIBUTES = [
  'data-theme',
  'data-color-mode',
  'data-color-scheme',
  'data-mode',
  'data-scheme',
  'data-bs-theme',
];

/**
 * Turns a single class or attribute value into a theme name. Class names such
 * as "theme-dark", "dark-mode" and "color-scheme-light" are recognised, while
 * unrelated words like "highlight" are ignored.
 */
export function normalizeThemeName(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text || AMBIGUOUS_VALUES.has(text)) return null;
  const dark = /(^|[-_])(dark|night|dim)([-_]|$)/.test(text);
  const light = /(^|[-_])(light|day)([-_]|$)/.test(text);
  if (dark && !light) return 'dark';
  if (light && !dark) return 'light';
  return null;
}

/** Reads rgba()/rgb()/#rrggbb colours, including the modern space syntax. */
export function parseColor(value) {
  if (!value) return null;
  const text = String(value).trim().toLowerCase();
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (text === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (text === 'white') return { r: 255, g: 255, b: 255, a: 1 };

  const hex = text.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const digits = hex[1];
    const expand = (part) => Number.parseInt(part.length === 1 ? part + part : part, 16);
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: expand(digits[0]),
        g: expand(digits[1]),
        b: expand(digits[2]),
        a: digits.length === 4 ? expand(digits[3]) / 255 : 1,
      };
    }
    return {
      r: expand(digits.slice(0, 2)),
      g: expand(digits.slice(2, 4)),
      b: expand(digits.slice(4, 6)),
      a: digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1,
    };
  }

  const rgb = text.match(/^rgba?\(([^)]+)\)$/);
  if (!rgb) return null;
  const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 4);
  if (parts.length < 3) return null;
  const channels = parts.slice(0, 3).map(parseChannel);
  if (channels.some((channel) => !Number.isFinite(channel))) return null;
  const alpha = parts.length > 3 ? Number.parseFloat(parts[3]) : 1;
  return {
    r: channels[0],
    g: channels[1],
    b: channels[2],
    a: Number.isFinite(alpha) ? alpha : 1,
  };
}

function parseChannel(value) {
  const text = String(value);
  if (text.endsWith('%')) return (Number.parseFloat(text) / 100) * 255;
  return Number.parseFloat(text);
}

/** WCAG relative luminance; 0 is black, 1 is white. */
export function relativeLuminance(color) {
  if (!color) return 0;
  const channel = (value) => {
    const normalized = Math.min(255, Math.max(0, Number(value) || 0)) / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

export function themeFromLuminance(luminance) {
  return Number(luminance) >= 0.45 ? 'light' : 'dark';
}

/** Reads `color-scheme`; "light dark" is ambiguous and returns null. */
export function themeFromColorScheme(value) {
  const text = String(value ?? '').toLowerCase();
  const dark = /\bdark\b/.test(text);
  const light = /\blight\b/.test(text);
  if (dark && !light) return 'dark';
  if (light && !dark) return 'light';
  return null;
}

function attributeTheme(element) {
  for (const name of THEME_ATTRIBUTES) {
    const theme = normalizeThemeName(element?.getAttribute?.(name));
    if (theme) return theme;
  }
  return null;
}

function classTheme(element) {
  const tokens = String(element?.getAttribute?.('class') || '').split(/\s+/).filter(Boolean);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const theme = normalizeThemeName(tokens[index]);
    if (theme) return theme;
  }
  return null;
}

function computedTheme(win, element) {
  if (!win?.getComputedStyle || !element) return null;
  try {
    return themeFromColorScheme(win.getComputedStyle(element)?.colorScheme);
  } catch {
    return null;
  }
}

function backgroundTheme(win, element) {
  if (!win?.getComputedStyle || !element) return null;
  try {
    const color = parseColor(win.getComputedStyle(element)?.backgroundColor);
    if (!color || color.a < 0.5) return null;
    return themeFromLuminance(relativeLuminance(color));
  } catch {
    return null;
  }
}

/**
 * Best-effort light/dark detection for the page the panel is injected into.
 * Explicit site classes and data attributes win over computed colours, and the
 * operating-system preference is only a last resort.
 */
export function detectSiteTheme(doc = globalThis.document, win = globalThis) {
  const elements = [doc?.documentElement, doc?.body].filter(Boolean);
  if (elements.length === 0) return 'dark';

  for (const element of elements) {
    const theme = attributeTheme(element);
    if (theme) return theme;
  }
  for (const element of elements) {
    const theme = classTheme(element);
    if (theme) return theme;
  }
  for (const element of elements) {
    const theme = computedTheme(win, element);
    if (theme) return theme;
  }
  for (const element of [doc?.body, doc?.documentElement]) {
    const theme = backgroundTheme(win, element);
    if (theme) return theme;
  }
  const media = win?.matchMedia?.('(prefers-color-scheme: dark)');
  if (media && typeof media.matches === 'boolean') return media.matches ? 'dark' : 'light';
  return 'dark';
}

/**
 * Calls `callback(theme)` once immediately and then whenever the page theme
 * changes. Returns a cleanup function.
 */
export function watchSiteTheme(callback, { doc = globalThis.document, win = globalThis } = {}) {
  if (!doc || typeof callback !== 'function') return () => {};
  let last = null;
  let queued = false;

  const check = () => {
    if (queued) return;
    queued = true;
    const run = () => {
      queued = false;
      const theme = detectSiteTheme(doc, win);
      if (theme === last) return;
      last = theme;
      callback(theme);
    };
    if (typeof win?.queueMicrotask === 'function') win.queueMicrotask(run);
    else if (typeof win?.setTimeout === 'function') win.setTimeout(run, 0);
    else run();
  };

  const Observer = win?.MutationObserver || globalThis.MutationObserver;
  let observer = null;
  if (typeof Observer === 'function' && doc.documentElement) {
    observer = new Observer(check);
    const config = {
      attributes: true,
      attributeFilter: ['class', 'style', ...THEME_ATTRIBUTES],
    };
    observer.observe(doc.documentElement, config);
    if (doc.body) observer.observe(doc.body, config);
  }

  let media = null;
  const onMediaChange = () => check();
  if (typeof win?.matchMedia === 'function') {
    media = win.matchMedia('(prefers-color-scheme: dark)');
    if (typeof media?.addEventListener === 'function') media.addEventListener('change', onMediaChange);
    else media?.addListener?.(onMediaChange);
  }

  const initial = detectSiteTheme(doc, win);
  last = initial;
  callback(initial);

  return () => {
    observer?.disconnect();
    if (typeof media?.removeEventListener === 'function') media.removeEventListener('change', onMediaChange);
    else media?.removeListener?.(onMediaChange);
  };
}
