import {
  DEFAULT_SETTINGS,
  DEPTH_MAX,
  DEPTH_MIN,
  MAX_PLIES_LIMIT,
} from './constants.js';

function storageArea() {
  const api = globalThis.browser ?? globalThis.chrome;
  return api?.storage?.sync ?? null;
}

export function sanitizeSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const depth = Number(source.depth);
  const maxPlies = Number(source.maxPlies);
  return {
    depth: Number.isFinite(depth)
      ? Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, Math.round(depth)))
      : DEFAULT_SETTINGS.depth,
    maxPlies: Number.isFinite(maxPlies)
      ? Math.min(MAX_PLIES_LIMIT, Math.max(0, Math.round(maxPlies)))
      : DEFAULT_SETTINGS.maxPlies,
    autoOpen:
      source.autoOpen === undefined
        ? DEFAULT_SETTINGS.autoOpen
        : Boolean(source.autoOpen),
    showArrow:
      source.showArrow === undefined
        ? DEFAULT_SETTINGS.showArrow
        : Boolean(source.showArrow),
  };
}

export async function loadSettings() {
  const area = storageArea();
  if (!area) return { ...DEFAULT_SETTINGS };
  try {
    const stored = await area.get(DEFAULT_SETTINGS);
    return sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch) {
  const area = storageArea();
  const next = sanitizeSettings({ ...DEFAULT_SETTINGS, ...patch });
  if (area) {
    await area.set(next);
  }
  return next;
}

export function subscribeToSettings(callback) {
  const api = globalThis.browser ?? globalThis.chrome;
  if (!api?.storage?.onChanged) return () => {};
  const listener = (changes, areaName) => {
    if (areaName !== 'sync') return;
    if (!['depth', 'maxPlies', 'autoOpen', 'showArrow'].some((key) => key in changes)) return;
    loadSettings().then(callback);
  };
  api.storage.onChanged.addListener(listener);
  return () => api.storage.onChanged.removeListener(listener);
}
