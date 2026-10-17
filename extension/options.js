// Capturazo — bienvenida y ajustes.

import { ALL_SITES, DEFAULT_SETTINGS, REMOTE_URL, getSettings, grantedOrigins, hasAllSites, removeOrigins, requestOrigins, saveSettings } from './config.js';
import { applyI18n, t } from './lib/i18n.js';

applyI18n();

const $ = (id) => document.getElementById(id);
$('version').textContent = chrome.runtime.getManifest().version;

let settings = await getSettings();

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 1800);
}

async function save(patch) {
  settings = await saveSettings(patch);
  render();
  toast(t('saved'));
}

// ---------------------------------------------------------------- sitios

async function renderSites() {
  const all = await hasAllSites();
  $('all-sites').checked = all;
  const origins = (await grantedOrigins()).filter((o) => !ALL_SITES.origins.includes(o));
  $('sites').replaceChildren(...origins.map((origin) => {
    const li = document.createElement('li');
    const dot = Object.assign(document.createElement('span'), { className: 'dot' });
    const host = Object.assign(document.createElement('span'), { className: 'host', textContent: origin.replace(/^https?:\/\//, '').replace(/\/\*$/, '') });
    const remove = Object.assign(document.createElement('button'), { className: 'btn small ghost', type: 'button', textContent: t('remove') });
    remove.addEventListener('click', async () => {
      await removeOrigins([origin]);
      renderSites();
    });
    li.append(dot, host, remove);
    return li;
  }));
  $('sites-empty').hidden = all || origins.length > 0;
}

$('all-sites').addEventListener('change', async (e) => {
  if (e.target.checked) {
    if (!(await requestOrigins(ALL_SITES.origins))) e.target.checked = false;
  } else {
    await removeOrigins(ALL_SITES.origins);
  }
  renderSites();
});

chrome.permissions.onAdded.addListener(renderSites);
chrome.permissions.onRemoved.addListener(renderSites);

// ---------------------------------------------------------------- ajustes

const SEGMENTS = {
  quality: { key: 'quality', parse: String },
  fps: { key: 'fps', parse: Number },
  'mic-mode': { key: 'micMode', parse: String },
  'photo-format': { key: 'photoFormat', parse: String },
  'rec-format': { key: 'recFormat', parse: String },
};

for (const [id, { key, parse }] of Object.entries(SEGMENTS)) {
  for (const b of $(id).querySelectorAll('button')) {
    b.addEventListener('click', () => save({ [key]: parse(b.dataset.v) }));
  }
}

for (const input of document.querySelectorAll('[data-setting]')) {
  input.addEventListener('change', () => save({ [input.dataset.setting]: input.checked }));
}

$('remote-url').placeholder = REMOTE_URL;
$('remote-url').addEventListener('change', async (e) => {
  const value = e.target.value.trim();
  if (value) {
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol)) throw new Error();
    } catch {
      toast(t('remoteUrlInvalid'));
      e.target.value = settings.remoteUrl;
      return;
    }
  }
  save({ remoteUrl: value });
});
$('remote-url-reset').addEventListener('click', () => save({ remoteUrl: DEFAULT_SETTINGS.remoteUrl }));

function render() {
  for (const [id, { key }] of Object.entries(SEGMENTS)) {
    for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.v === String(settings[key])));
  }
  for (const input of document.querySelectorAll('[data-setting]')) input.checked = !!settings[input.dataset.setting];
  if (document.activeElement !== $('remote-url')) $('remote-url').value = settings.remoteUrl || '';
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) getSettings().then((s) => { settings = s; render(); });
});

$('open-visor').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('visor.html') }));

render();
renderSites();
if (location.hash === '#bienvenida') document.title = t('welcomeTitle');
