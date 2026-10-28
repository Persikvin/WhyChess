import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  detectSiteTheme,
  normalizeThemeName,
  parseColor,
  relativeLuminance,
  themeFromColorScheme,
  themeFromLuminance,
  watchSiteTheme,
} from '../src/content/theme.js';

function makeWindow(html = '<html><body></body></html>') {
  return new JSDOM(`<!doctype html>${html}`, { url: 'https://lichess.org/analysis' }).window;
}

function fakeStyleWindow(doc, styles) {
  return {
    getComputedStyle(element) {
      return styles(element) || { colorScheme: 'normal', backgroundColor: 'rgba(0, 0, 0, 0)' };
    },
    matchMedia: () => ({ matches: false }),
  };
}

describe('normalizeThemeName', () => {
  it('recognises common site theme tokens', () => {
    expect(normalizeThemeName('dark')).toBe('dark');
    expect(normalizeThemeName('night-mode')).toBe('dark');
    expect(normalizeThemeName('theme-light')).toBe('light');
    expect(normalizeThemeName('day')).toBe('light');
    expect(normalizeThemeName('color-scheme-dark')).toBe('dark');
  });

  it('ignores unrelated words and automatic modes', () => {
    expect(normalizeThemeName('highlight')).toBeNull();
    expect(normalizeThemeName('darkboard')).toBeNull();
    expect(normalizeThemeName('auto')).toBeNull();
    expect(normalizeThemeName('')).toBeNull();
  });
});

describe('color helpers', () => {
  it('parses hex, rgb and rgba colours', () => {
    expect(parseColor('#0c1424')).toEqual({ r: 12, g: 20, b: 36, a: 1 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('rgb(240, 217, 181)')).toEqual({ r: 240, g: 217, b: 181, a: 1 });
    expect(parseColor('rgb(240 217 181 / 0.5)')).toEqual({ r: 240, g: 217, b: 181, a: 0.5 });
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor('not-a-colour')).toBeNull();
  });

  it('computes luminance from black to white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBe(1);
    expect(relativeLuminance({ r: 12, g: 20, b: 36 })).toBeLessThan(0.1);
  });

  it('maps luminance and color-scheme values to themes', () => {
    expect(themeFromLuminance(0.9)).toBe('light');
    expect(themeFromLuminance(0.05)).toBe('dark');
    expect(themeFromColorScheme('dark')).toBe('dark');
    expect(themeFromColorScheme('light')).toBe('light');
    expect(themeFromColorScheme('light dark')).toBeNull();
  });
});

describe('detectSiteTheme', () => {
  it('prefers explicit data attributes over classes', () => {
    const win = makeWindow('<html class="light" data-theme="dark"><body></body></html>');
    expect(detectSiteTheme(win.document, win)).toBe('dark');
  });

  it('reads theme classes from the document or body', () => {
    const dark = makeWindow('<html><body class="dark-mode"></body></html>');
    expect(detectSiteTheme(dark.document, dark)).toBe('dark');
    const light = makeWindow('<html class="theme-light"><body></body></html>');
    expect(detectSiteTheme(light.document, light)).toBe('light');
  });

  it('uses color-scheme when no class is present', () => {
    const win = makeWindow();
    const doc = win.document;
    const fake = fakeStyleWindow(doc, (element) => ({
      colorScheme: element === doc.documentElement ? 'dark' : 'normal',
      backgroundColor: 'rgba(0, 0, 0, 0)',
    }));
    expect(detectSiteTheme(doc, fake)).toBe('dark');
  });

  it('falls back to the page background colour', () => {
    const win = makeWindow();
    const doc = win.document;
    const fake = fakeStyleWindow(doc, (element) => ({
      colorScheme: 'normal',
      backgroundColor: element === doc.body ? 'rgb(248, 250, 252)' : 'rgba(0, 0, 0, 0)',
    }));
    expect(detectSiteTheme(doc, fake)).toBe('light');
  });

  it('uses prefers-color-scheme as the final fallback', () => {
    const win = makeWindow();
    const fake = {
      getComputedStyle: () => ({ colorScheme: 'normal', backgroundColor: 'transparent' }),
      matchMedia: () => ({ matches: true }),
    };
    expect(detectSiteTheme(win.document, fake)).toBe('dark');
  });
});

describe('watchSiteTheme', () => {
  it('reports the initial theme and reacts to class changes', async () => {
    const win = makeWindow('<html class="dark"><body></body></html>');
    const themes = [];
    const stop = watchSiteTheme((theme) => themes.push(theme), {
      doc: win.document,
      win,
    });

    expect(themes).toEqual(['dark']);
    win.document.documentElement.classList.remove('dark');
    win.document.documentElement.classList.add('light');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(themes.at(-1)).toBe('light');
    stop();
  });
});
