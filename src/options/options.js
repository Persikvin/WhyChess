import { DEFAULT_SETTINGS, DEPTH_MAX, DEPTH_MIN, MAX_PLIES_LIMIT } from '../shared/constants.js';
import { loadSettings, saveSettings } from '../shared/settings.js';

const api = globalThis.browser ?? globalThis.chrome;
const form = document.getElementById('settings-form');
const depth = document.getElementById('depth');
const depthValue = document.getElementById('depth-value');
const maxPlies = document.getElementById('maxPlies');
const maxPliesValue = document.getElementById('max-plies-value');
const autoOpen = document.getElementById('autoOpen');
const showArrow = document.getElementById('showArrow');
const status = document.getElementById('status');
const reset = document.getElementById('reset');
const version = document.getElementById('version');

let statusTimer = null;

async function init() {
  version.textContent = `v${api?.runtime?.getManifest?.().version || '1.0.0'}`;
  const settings = await loadSettings();
  apply(settings);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    persist(readForm());
  });
  reset.addEventListener('click', () => {
    apply(DEFAULT_SETTINGS);
    persist(DEFAULT_SETTINGS);
  });
  depth.addEventListener('input', () => {
    depthValue.textContent = depth.value;
  });
  maxPlies.addEventListener('input', () => {
    maxPliesValue.textContent = maxPlies.value || '0';
  });
  for (const input of [autoOpen, showArrow]) {
    input.addEventListener('change', () => persist(readForm()));
  }
}

function apply(settings) {
  depth.value = String(clamp(settings.depth, DEPTH_MIN, DEPTH_MAX));
  depthValue.textContent = depth.value;
  maxPlies.value = String(clamp(settings.maxPlies, 0, MAX_PLIES_LIMIT));
  maxPliesValue.textContent = maxPlies.value;
  autoOpen.checked = Boolean(settings.autoOpen);
  showArrow.checked = Boolean(settings.showArrow);
}

function readForm() {
  return {
    depth: Number(depth.value),
    maxPlies: Number(maxPlies.value),
    autoOpen: autoOpen.checked,
    showArrow: showArrow.checked,
  };
}

async function persist(settings) {
  try {
    const saved = await saveSettings(settings);
    apply(saved);
    setStatus('Сохранено');
  } catch (error) {
    setStatus(`Не удалось сохранить: ${error.message}`, true);
  }
}

function setStatus(text, isError = false) {
  clearTimeout(statusTimer);
  status.textContent = text;
  status.classList.toggle('is-error', isError);
  statusTimer = setTimeout(() => {
    status.textContent = '';
    status.classList.remove('is-error');
  }, 3200);
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

init();
