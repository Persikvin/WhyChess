import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadSettings,
  sanitizeSettings,
  saveSettings,
  subscribeToSettings,
} from '../src/shared/settings.js';
import { DEFAULT_SETTINGS } from '../src/shared/constants.js';

function installStorage({ stored = {}, getError = null } = {}) {
  const listeners = [];
  const area = {
    get: vi.fn(async (defaults) => {
      if (getError) throw getError;
      return { ...defaults, ...stored };
    }),
    set: vi.fn(async () => {}),
  };
  const onChanged = {
    addListener: vi.fn((listener) => listeners.push(listener)),
    removeListener: vi.fn((listener) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    }),
  };
  globalThis.chrome = { storage: { sync: area, onChanged } };
  return { area, onChanged, listeners };
}

function removeExtensionApis() {
  delete globalThis.chrome;
  delete globalThis.browser;
}

beforeEach(removeExtensionApis);
afterEach(removeExtensionApis);

describe('sanitizeSettings', () => {
  it('returns defaults for empty input', () => {
    expect(sanitizeSettings()).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps depth and maxPlies', () => {
    expect(sanitizeSettings({ depth: 2, maxPlies: -5 })).toMatchObject({
      depth: 4,
      maxPlies: 0,
    });
    expect(sanitizeSettings({ depth: 99, maxPlies: 9999 })).toMatchObject({
      depth: 18,
      maxPlies: 300,
    });
    expect(sanitizeSettings({ depth: 10.6, maxPlies: 12.4 })).toMatchObject({
      depth: 11,
      maxPlies: 12,
    });
    expect(sanitizeSettings({ depth: '12', maxPlies: '40' })).toMatchObject({
      depth: 12,
      maxPlies: 40,
    });
    expect(sanitizeSettings({ depth: 'abc', maxPlies: undefined })).toMatchObject({
      depth: DEFAULT_SETTINGS.depth,
      maxPlies: DEFAULT_SETTINGS.maxPlies,
    });
  });

  it('coerces booleans while preserving defaults', () => {
    expect(sanitizeSettings({ autoOpen: 0, showArrow: 'yes' })).toMatchObject({
      autoOpen: false,
      showArrow: true,
    });
    expect(sanitizeSettings({})).toMatchObject({
      autoOpen: DEFAULT_SETTINGS.autoOpen,
      showArrow: DEFAULT_SETTINGS.showArrow,
    });
  });
});

describe('loadSettings', () => {
  it('returns defaults when extension storage is unavailable', async () => {
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('loads and sanitises stored values', async () => {
    installStorage({ stored: { depth: 12, maxPlies: 120, autoOpen: false, showArrow: false } });
    await expect(loadSettings()).resolves.toEqual({
      depth: 12,
      maxPlies: 120,
      autoOpen: false,
      showArrow: false,
    });
  });

  it('clamps stored values and fills missing keys', async () => {
    installStorage({ stored: { depth: 999 } });
    await expect(loadSettings()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      depth: 18,
    });
  });

  it('falls back to defaults on storage errors', async () => {
    installStorage({ getError: new Error('storage failed') });
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });
});

describe('saveSettings', () => {
  it('writes sanitised settings and returns them', async () => {
    const { area } = installStorage();
    const saved = await saveSettings({ depth: 50, maxPlies: 1000, autoOpen: false });
    expect(saved).toEqual({
      depth: 18,
      maxPlies: 300,
      autoOpen: false,
      showArrow: true,
    });
    expect(area.set).toHaveBeenCalledWith(saved);
  });

  it('works without extension storage', async () => {
    await expect(saveSettings({ depth: 8 })).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      depth: 8,
    });
  });
});

describe('subscribeToSettings', () => {
  it('reloads settings for relevant sync changes', async () => {
    const { area, onChanged, listeners } = installStorage({ stored: { depth: 12 } });
    const callback = vi.fn();
    const unsubscribe = subscribeToSettings(callback);

    expect(onChanged.addListener).toHaveBeenCalledOnce();
    expect(listeners).toHaveLength(1);

    listeners[0]({ depth: { newValue: 12 } }, 'sync');
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
    expect(callback.mock.calls[0][0]).toMatchObject({ depth: 12 });
    expect(area.get).toHaveBeenCalled();

    unsubscribe();
    expect(onChanged.removeListener).toHaveBeenCalledOnce();
    expect(listeners).toHaveLength(0);
  });

  it('ignores unrelated areas and keys', async () => {
    const { listeners } = installStorage();
    const callback = vi.fn();
    subscribeToSettings(callback);

    listeners[0]({ depth: { newValue: 12 } }, 'local');
    listeners[0]({ theme: { newValue: 'dark' } }, 'sync');
    await Promise.resolve();
    expect(callback).not.toHaveBeenCalled();
  });

  it('returns a no-op without storage APIs', () => {
    const unsubscribe = subscribeToSettings(() => {});
    expect(typeof unsubscribe).toBe('function');
    expect(unsubscribe()).toBeUndefined();
  });
});
