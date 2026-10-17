/* global CapturazoRelay */
import { REMOTE_URL, buildRemoteUrl, getSettings, originPattern, requestOrigins } from './config.js';
import qrcode from './lib/qrcode.mjs';
import { applyI18n, t } from './lib/i18n.js';

applyI18n();

const $ = (id) => document.getElementById(id);
const sw = (type, extra = {}) => chrome.runtime.sendMessage({ to: 'sw', type, ...extra });
const lang = 'es';

let settings = await getSettings();
let snap = null;
let renderedUrl = '';
let showQr = false;
const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
const sitePattern = originPattern(currentTab?.url);
let siteOn = sitePattern ? await chrome.permissions.contains({ origins: [sitePattern] }) : false;
let siteJustEnabled = false;

// ---------------------------------------------------------------- QR

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const isEye = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  let dots = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!isEye(r, c) && qr.isDark(r, c)) dots += `<rect x="${c + 0.05}" y="${r + 0.05}" width=".9" height=".9" rx=".3"/>`;
    }
  }
  const eye = (x, y) =>
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.8" fill="none" stroke="currentColor" stroke-width="1"/>` +
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx=".9"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="geometricPrecision">` +
    `<g fill="currentColor">${dots}${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}</g></svg>`;
}

function remoteUrl() {
  if (!snap?.identity) return '';
  return buildRemoteUrl(settings.remoteUrl || REMOTE_URL, snap.identity.peerId, snap.identity.token);
}

// ---------------------------------------------------------------- vista previa (conexión local)

const preview = $('preview');
let relay = null;

function setPreview(on) {
  if (on && !relay) {
    relay = CapturazoRelay.connect({
      kind: 'popup',
      onStream: (stream) => {
        if (preview.srcObject !== stream) preview.srcObject = stream;
        preview.play().catch(() => {});
      },
    });
  } else if (!on && relay) {
    relay.close();
    relay = null;
    preview.srcObject = null;
  }
}

let framesOk = false;
preview.addEventListener('resize', () => { framesOk = preview.videoWidth > 0; render(); });
preview.addEventListener('playing', () => { framesOk = preview.videoWidth > 0; render(); });
preview.addEventListener('emptied', () => { framesOk = false; });

// ---------------------------------------------------------------- render

function activeDevice(state) {
  return state.devices.find((d) => d.id === state.activeId) || null;
}

function statusView(state) {
  if (!state.active) return ['muted', t('statusStopped')];
  const dev = activeDevice(state);
  if (dev?.streaming) return ['ok', t('statusLive')];
  if (state.devices.length) return ['ok', state.devices.length === 1 ? t('statusConnectedOne') : t('statusConnectedMany', [String(state.devices.length)])];
  switch (state.status) {
    case 'ready': return ['ok', t('statusReady')];
    case 'error': return ['error', t('statusOffline')];
    default: return ['warn', t('statusConnecting')];
  }
}

function since(ts) {
  const minutes = Math.round((Date.now() - ts) / 60000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  return minutes < 1 ? t('justNow') : rtf.format(-minutes, 'minute');
}

function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function render() {
  if (!snap) return;
  const { state } = snap;
  const dev = activeDevice(state);
  const media = dev?.media || {};
  const live = state.active && !!dev?.streaming;

  const [tone, text] = statusView(state);
  $('status').dataset.tone = tone;
  $('status-text').textContent = text;

  $('stopped').hidden = state.active;
  $('scan').hidden = !state.active || (live && !showQr);
  $('live').hidden = !live;
  $('copy').disabled = !state.active;
  $('reset').disabled = !state.active;
  $('stop').hidden = !state.active;
  $('copy').hidden = live && !showQr;
  $('show-qr').hidden = !live || showQr;
  setPreview(live);

  const url = remoteUrl();
  if (state.active && url && url !== renderedUrl) {
    $('qr').innerHTML = qrSvg(url);
    renderedUrl = url;
  }
  $('qr-card').classList.toggle('loading', state.status !== 'ready');

  let alert = '';
  if (state.active && state.status === 'error') alert = state.error === 'network' ? t('errorNetwork') : t('errorGeneric');
  $('alert').hidden = !alert;
  $('alert').textContent = alert;

  // Señal del celular
  if (live) {
    const cam = media.cam || {};
    const mic = media.mic || {};
    $('dev-name').textContent = dev.name;
    const waiting = !cam.on || !framesOk;
    $('screen-wait').hidden = !waiting;
    $('screen-wait-text').textContent = cam.on ? t('connectingShort') : t('camOffShort');
    $('screen-wait').querySelector('.spinner').hidden = !cam.on;
    $('res-tag').hidden = !cam.on || !cam.w;
    $('res-tag').textContent = cam.w ? `${Math.max(cam.w, cam.h)}×${Math.min(cam.w, cam.h)} · ${cam.fps || 30}` : '';

    const cams = media.cams || [];
    $('cams').replaceChildren(...(cams.length > 1 ? cams : []).map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(!!cam.on && c.id === cam.id));
      b.textContent = c.label;
      b.addEventListener('click', () => sw('phone:set', { id: dev.id, set: { cam: c.id } }));
      return b;
    }));

    for (const b of $('mode').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.mode === (mic.mode || 'nr')));
    $('mode').classList.toggle('disabled', !mic.on);
    $('mic-btn').setAttribute('aria-pressed', String(!!mic.on));
    $('cam-btn').setAttribute('aria-pressed', String(!!cam.on));
    $('photo-btn').disabled = !cam.on;
    $('flip-btn').disabled = !cam.on;

    const recording = !!state.rec;
    $('rec-btn').setAttribute('aria-pressed', String(recording));
    $('rec-label').textContent = recording ? t('stopRec') : t('record');
    $('rec-tag').hidden = !recording;
    if (recording) $('rec-time').textContent = clock(Date.now() - state.rec.since);
  }

  // Celulares conectados
  const showDevices = state.active && state.devices.length > 0 && (state.devices.length > 1 || !live);
  $('devices-card').hidden = !showDevices;
  $('devices').replaceChildren(...state.devices.map((d) => {
    const li = document.createElement('li');
    li.className = d.streaming && d.id === state.activeId ? 'on' : '';
    li.innerHTML = '<span class="dev-icon"></span><span class="dev-text"><span class="dev-name"></span><span class="dev-since"></span></span>';
    li.querySelector('.dev-name').textContent = d.name;
    li.querySelector('.dev-since').textContent = d.streaming
      ? (d.id === state.activeId ? t('onAir') : `${t('connected')} · ${since(d.since)}`)
      : t('waitingStart');
    if (d.streaming && d.id !== state.activeId) {
      const use = document.createElement('button');
      use.className = 'btn small';
      use.textContent = t('use');
      use.addEventListener('click', () => sw('use', { id: d.id }));
      li.append(use);
    }
    const kick = document.createElement('button');
    kick.className = 'btn small ghost';
    kick.textContent = t('disconnect');
    kick.addEventListener('click', () => sw('device:kick', { id: d.id }));
    li.append(kick);
    return li;
  }));

  renderSite(state);

  // Último archivo guardado
  const saved = state.lastSave && Date.now() - state.lastSave.at < 15000 ? state.lastSave : null;
  $('saved').hidden = !saved;
  if (saved) $('saved').textContent = t(saved.kind === 'video' ? 'savedVideo' : 'savedPhoto', [saved.filename]);
}

function renderSite(state) {
  const card = $('site-card');
  card.hidden = !currentTab?.url || !/^https?:/.test(currentTab.url);
  if (card.hidden) return;
  let host = '';
  try { host = new URL(currentTab.url).hostname; } catch {}
  $('site-title').textContent = host;
  const icon = $('site-icon');
  if (currentTab.favIconUrl && /^https?:|^data:/.test(currentTab.favIconUrl)) {
    icon.src = currentTab.favIconUrl;
    icon.hidden = false;
    $('site-fallback').hidden = true;
  } else {
    icon.hidden = true;
    $('site-fallback').hidden = false;
    $('site-fallback').textContent = host.replace(/^www\./, '').charAt(0);
  }
  const using = state.consumers.some((c) => c.kind === 'page' && c.tabId === currentTab.id);
  card.classList.toggle('off', !!sitePattern && !siteOn);
  $('site-enable').hidden = !sitePattern || siteOn;
  $('site-ok').hidden = !siteOn;
  $('site-reload').hidden = !siteJustEnabled;
  $('site-sub').textContent = !sitePattern ? t('siteRestricted')
    : using ? t('siteUsing')
      : siteJustEnabled ? t('siteEnabledSub')
        : siteOn ? t('siteOnSub') : t('siteOffSub');
}

async function refresh() {
  snap = await sw('session:get');
  render();
}

// ---------------------------------------------------------------- acciones

$('start').addEventListener('click', async () => {
  snap = await sw('session:start');
  render();
});

$('stop').addEventListener('click', async () => {
  snap = await sw('session:stop');
  render();
});

const phone = (set) => {
  const dev = snap && activeDevice(snap.state);
  if (dev) sw('phone:set', { id: dev.id, set });
};

$('mic-btn').addEventListener('click', () => phone({ micOn: $('mic-btn').getAttribute('aria-pressed') !== 'true' }));
$('cam-btn').addEventListener('click', () => phone({ camOn: $('cam-btn').getAttribute('aria-pressed') !== 'true' }));
$('flip-btn').addEventListener('click', () => phone({ flip: true }));
for (const b of $('mode').querySelectorAll('button')) b.addEventListener('click', () => phone({ mode: b.dataset.mode }));
$('photo-btn').addEventListener('click', () => sw('snap'));
$('rec-btn').addEventListener('click', async () => {
  const recording = $('rec-btn').getAttribute('aria-pressed') === 'true';
  const res = await sw(recording ? 'rec:stop' : 'rec:start');
  if (res && res.ok === false) {
    $('alert').hidden = false;
    $('alert').textContent = t('recFailed');
  }
});
$('open-visor').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('visor.html') });
  window.close();
});
$('show-qr').addEventListener('click', () => { showQr = true; render(); });

$('site-enable').addEventListener('click', async () => {
  // El diálogo de Chrome debe abrirse directamente desde el clic.
  const ok = await requestOrigins([sitePattern]);
  if (!ok) return;
  siteOn = true;
  siteJustEnabled = true;
  render();
  await sw('site:enabled', { tabId: currentTab.id });
});
$('site-reload').addEventListener('click', () => {
  chrome.tabs.reload(currentTab.id);
  window.close();
});

$('copy').addEventListener('click', async () => {
  const label = $('copy').querySelector('span');
  try {
    await navigator.clipboard.writeText(remoteUrl());
    label.textContent = t('copied');
  } catch {
    label.textContent = t('copyFailed');
  }
  setTimeout(() => { label.textContent = t('copyLink'); }, 1600);
});

let confirmTimer = 0;
$('reset').addEventListener('click', async () => {
  const btn = $('reset');
  const label = btn.querySelector('span');
  if (!btn.classList.contains('confirm')) {
    btn.classList.add('confirm');
    label.textContent = t('newCodeConfirm');
    confirmTimer = setTimeout(() => {
      btn.classList.remove('confirm');
      label.textContent = t('newCode');
    }, 3000);
    return;
  }
  clearTimeout(confirmTimer);
  btn.classList.remove('confirm');
  label.textContent = t('newCode');
  snap = await sw('session:reset');
  render();
});

$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

chrome.storage.session.onChanged.addListener((changes) => { if (changes.state) refresh(); });
const accessChanged = async () => {
  siteOn = sitePattern ? await chrome.permissions.contains({ origins: [sitePattern] }) : false;
  render();
};
chrome.permissions.onAdded.addListener(accessChanged);
chrome.permissions.onRemoved.addListener(accessChanged);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) getSettings().then((s) => { settings = s; render(); });
});

// Abrir el panel inicia (o reanuda) la sesión.
snap = await sw('session:start');
render();
// Cronómetro de la grabación y aviso del último archivo (sin volver a dibujar los botones).
setInterval(() => {
  const state = snap?.state;
  if (!state) return;
  if (state.rec) $('rec-time').textContent = clock(Date.now() - state.rec.since);
  if (!$('saved').hidden && !(state.lastSave && Date.now() - state.lastSave.at < 15000)) $('saved').hidden = true;
}, 500);
