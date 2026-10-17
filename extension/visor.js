/* global CapturazoRelay */
// Capturazo — visor: la cámara del celular en una pestaña o ventana de la computadora.
// Sirve para verla en grande, capturarla con OBS (captura de ventana), tomar fotos,
// grabar, escuchar el micrófono y mandarlo a otra salida de audio.

import { REMOTE_URL, buildRemoteUrl, getSettings } from './config.js';
import qrcode from './lib/qrcode.mjs';
import { applyI18n, t } from './lib/i18n.js';

applyI18n();

const $ = (id) => document.getElementById(id);
const sw = (type, extra = {}) => chrome.runtime.sendMessage({ to: 'sw', type, ...extra });
const visor = $('visor');
const video = $('video');
const query = new URLSearchParams(location.search);

// Preferencias de este visor (solo en este equipo).
const prefs = (() => {
  const base = { mirror: false, rot: 0, fill: false, listen: false, sink: '' };
  // «Escuchar» siempre empieza apagado: Chrome no reproduce sonido sin un clic.
  try { return { ...base, ...JSON.parse(localStorage.getItem('capturazo.visor') || '{}'), listen: false }; } catch { return base; }
})();
const savePrefs = () => { try { localStorage.setItem('capturazo.visor', JSON.stringify(prefs)); } catch {} };

let settings = await getSettings();
let snap = null;
let framesOk = false;
let renderedUrl = '';
let lastSaveAt = 0;

// ---------------------------------------------------------------- señal (conexión local)

CapturazoRelay.connect({
  kind: 'visor',
  onStream: (stream) => {
    if (video.srcObject !== stream) video.srcObject = stream;
    video.play().catch(() => {});
  },
});

video.addEventListener('resize', () => { framesOk = video.videoWidth > 0; render(); });
video.addEventListener('playing', () => { framesOk = video.videoWidth > 0; render(); });
video.addEventListener('emptied', () => { framesOk = false; render(); });

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

// ---------------------------------------------------------------- render

function activeDevice(state) {
  return state.devices.find((d) => d.id === state.activeId) || null;
}

function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

let toastTimer = 0;
function toast(text, error = false) {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('error', error);
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
}

function render() {
  if (!snap) return;
  const { state, identity } = snap;
  const dev = activeDevice(state);
  const media = dev?.media || {};
  const cam = media.cam || {};
  const mic = media.mic || {};
  const live = state.active && !!dev?.streaming;

  // Pantalla de espera
  let idle = null;
  if (!state.active) idle = ['visorStoppedTitle', 'visorStoppedBody', false, false];
  else if (!state.devices.length) idle = ['visorIdleTitle', 'visorIdleBody', true, false];
  else if (!live) idle = ['visorStartTitle', 'visorStartBody', false, true];
  else if (!cam.on) idle = ['visorCamOffTitle', 'visorCamOffBody', false, false];
  else if (!framesOk) idle = ['visorConnectingTitle', 'visorConnectingBody', false, true];
  $('idle').hidden = !idle;
  if (idle) {
    $('idle-title').textContent = t(idle[0]);
    $('idle-body').textContent = t(idle[1], [dev?.name || '']);
    $('qr-card').hidden = !idle[2];
    $('idle-spinner').hidden = !idle[3];
    if (idle[2] && identity) {
      const url = buildRemoteUrl(settings.remoteUrl || REMOTE_URL, identity.peerId, identity.token);
      if (url !== renderedUrl) {
        $('qr').innerHTML = qrSvg(url);
        renderedUrl = url;
      }
    }
  }

  // Barras
  $('dock').hidden = !live;
  $('dev-chip').hidden = !live;
  $('dev-name').textContent = dev?.name || '';
  $('res-chip').hidden = !live || !cam.on || !cam.w;
  $('res-chip').textContent = cam.w ? `${Math.max(cam.w, cam.h)}×${Math.min(cam.w, cam.h)} · ${cam.fps || 30} fps` : '';
  document.title = live ? `${dev.name} · Capturazo` : t('visorTitle');

  // La lista solo se vuelve a crear si cambia (así no se cierra mientras se elige).
  const cams = media.cams || [];
  const select = $('cam-select');
  const camsKey = cams.map((c) => `${c.id}:${c.label}`).join('|');
  if (camsKey !== select.dataset.key) {
    select.replaceChildren(...cams.map((c) => new Option(c.label, c.id)));
    select.dataset.key = camsKey;
  }
  if (cam.id && select.value !== cam.id) select.value = cam.id;
  select.hidden = cams.length < 2;
  select.disabled = !cam.on;
  $('flip-btn').disabled = !cam.on;
  $('photo-btn').disabled = !cam.on;
  $('cam-btn').setAttribute('aria-pressed', String(!!cam.on));
  $('mic-btn').setAttribute('aria-pressed', String(!!mic.on));
  for (const b of $('mode').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.mode === (mic.mode || 'nr')));
  $('mode').classList.toggle('disabled', !mic.on);

  const recording = !!state.rec;
  $('rec-btn').setAttribute('aria-pressed', String(recording));
  $('rec-btn').title = recording ? t('stopRec') : t('recTitle');
  $('rec-chip').hidden = !recording;
  if (recording) $('rec-time').textContent = clock(Date.now() - state.rec.since);

  // Vista
  visor.classList.toggle('fill', prefs.fill);
  visor.classList.toggle('rot90', prefs.rot % 180 !== 0);
  video.style.setProperty('--rot', `${prefs.rot}deg`);
  video.style.setProperty('--flip', prefs.mirror ? -1 : 1);
  $('mirror-btn').setAttribute('aria-pressed', String(prefs.mirror));
  $('fit-btn').setAttribute('aria-pressed', String(prefs.fill));
  $('listen-btn').setAttribute('aria-pressed', String(prefs.listen));
  video.muted = !prefs.listen;
  $('sink-select').hidden = !prefs.listen || typeof video.setSinkId !== 'function';

  // Aviso del último archivo guardado
  if (state.lastSave && state.lastSave.at > lastSaveAt) {
    if (lastSaveAt) toast(t(state.lastSave.kind === 'video' ? 'savedVideo' : 'savedPhoto', [state.lastSave.filename]));
    lastSaveAt = state.lastSave.at;
  }
}

async function refresh() {
  snap = await sw('session:get');
  render();
}

// ---------------------------------------------------------------- salida de audio

async function fillSinks() {
  const select = $('sink-select');
  let outs = [];
  try { outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput'); } catch {}
  const named = outs.some((d) => d.label);
  const options = [new Option(t('sinkDefault'), '')];
  for (const d of outs) if (d.deviceId && d.deviceId !== 'default') options.push(new Option(d.label || t('sinkUnnamed'), d.deviceId));
  // Chrome solo muestra los nombres de las salidas si la página tiene permiso de micrófono.
  if (!named) options.push(new Option(t('sinkShowNames'), '__names'));
  select.replaceChildren(...options);
  select.value = options.some((o) => o.value === prefs.sink) ? prefs.sink : '';
}

async function applySink() {
  if (typeof video.setSinkId !== 'function') return;
  try {
    await video.setSinkId(prefs.sink || '');
  } catch {
    prefs.sink = '';
    savePrefs();
  }
}

$('sink-select').addEventListener('change', async (e) => {
  if (e.target.value === '__names') {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const tr of s.getTracks()) tr.stop();
    } catch {
      toast(t('sinkNamesDenied'), true);
    }
    await fillSinks();
    return;
  }
  prefs.sink = e.target.value;
  savePrefs();
  applySink();
});

// ---------------------------------------------------------------- controles

const phone = (set) => {
  const dev = snap && activeDevice(snap.state);
  if (dev) sw('phone:set', { id: dev.id, set });
};

$('cam-select').addEventListener('change', (e) => phone({ cam: e.target.value }));
$('flip-btn').addEventListener('click', () => phone({ flip: true }));
$('cam-btn').addEventListener('click', () => phone({ camOn: $('cam-btn').getAttribute('aria-pressed') !== 'true' }));
$('mic-btn').addEventListener('click', () => phone({ micOn: $('mic-btn').getAttribute('aria-pressed') !== 'true' }));
for (const b of $('mode').querySelectorAll('button')) b.addEventListener('click', () => phone({ mode: b.dataset.mode }));

async function photo() {
  const res = await sw('snap');
  if (res?.ok === false) toast(t('photoFailed'), true);
}

async function record() {
  const recording = !!snap?.state.rec;
  const res = await sw(recording ? 'rec:stop' : 'rec:start');
  if (res?.ok === false) toast(t('recFailed'), true);
}

function setPref(key, value) {
  prefs[key] = value;
  savePrefs();
  render();
}

async function listen(on) {
  setPref('listen', on);
  if (on) {
    await fillSinks();
    await applySink();
    video.play().catch(() => {});
  }
}

function fullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

function clean(on = !visor.classList.contains('clean')) {
  visor.classList.toggle('clean', on);
  if (on) toast(t('cleanOn'));
}

$('photo-btn').addEventListener('click', photo);
$('rec-btn').addEventListener('click', record);
$('mirror-btn').addEventListener('click', () => setPref('mirror', !prefs.mirror));
$('rotate-btn').addEventListener('click', () => setPref('rot', (prefs.rot + 90) % 360));
$('fit-btn').addEventListener('click', () => setPref('fill', !prefs.fill));
$('listen-btn').addEventListener('click', () => listen(!prefs.listen));
$('full-btn').addEventListener('click', fullscreen);
$('clean-btn').addEventListener('click', () => clean(true));

document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('select, input') || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === 'f') fullscreen();
  else if (key === 'm') setPref('mirror', !prefs.mirror);
  else if (key === 'r') record();
  else if (key === 'p' || key === ' ') { e.preventDefault(); photo(); }
  else if (key === 'h') clean();
  else if (key === 'l') listen(!prefs.listen);
  else if (key === 'escape' && visor.classList.contains('clean')) clean(false);
  else return;
  showUi();
});

// Las barras se ocultan solas: así la ventana queda limpia para capturarla con OBS.
let hideTimer = 0;
function showUi() {
  visor.classList.remove('hide-ui', 'idle-cursor');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if ($('dock').matches(':hover')) return showUi();
    visor.classList.add('hide-ui', 'idle-cursor');
  }, 2600);
}
document.addEventListener('mousemove', showUi);
document.addEventListener('mousedown', showUi);
if (query.has('limpio')) clean(true);

chrome.storage.session.onChanged.addListener((changes) => { if (changes.state) refresh(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) getSettings().then((s) => { settings = s; render(); });
});

// Abrir el visor inicia (o reanuda) la sesión.
snap = await sw('session:start');
render();
showUi();
setInterval(() => {
  if (snap?.state.rec) $('rec-time').textContent = clock(Date.now() - snap.state.rec.since);
}, 500);
