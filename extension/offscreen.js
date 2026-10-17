// Capturazo — documento offscreen.
// · Mantiene la conexión WebRTC (PeerJS) con los celulares y valida cada mensaje.
// · Recibe la cámara y el micrófono de cada celular y elige cuál está «al aire».
// · Reparte esa señal a las páginas que la usan como cámara o micrófono, al visor y
//   a la vista previa del panel, con conexiones WebRTC locales (dentro de Chrome).
// · Graba el video (MediaRecorder) y guarda las fotos que llegan del celular.

/* global Peer */

import { ICE_ENDPOINT, FALLBACK_ICE } from './config.js';

const ICE_REFRESH_MS = 3 * 60 * 60 * 1000; // las credenciales duran 4 h
const RELAY_PORT = 'capturazo-relay';

const devices = new Map();
const consumers = new Map();
let iceConfig = FALLBACK_ICE;
let identity = null;
let settings = {};
let peer = null;
let stopped = false;
let retryTimer = 0;
let retryDelay = 1000;
let activeId = null;

const toSW = (msg) => chrome.runtime.sendMessage({ to: 'sw', ...msg }).catch(() => null);

function setStatus(status, error = null) {
  toSW({ type: 'status', status, error });
}

// ---------------------------------------------------------------- conexión con el servidor de señalización

function connect() {
  if (stopped) return;
  clearTimeout(retryTimer);
  setStatus('connecting');
  // debug: 0 — los avisos internos de PeerJS se manejan abajo; si se imprimieran,
  // Chrome los mostraría como errores en la página de Extensiones.
  peer = new Peer(identity.peerId, { debug: 0, config: iceConfig });
  const current = peer;

  current.on('open', () => {
    retryDelay = 1000;
    setStatus('ready');
  });
  current.on('connection', onConnection);
  current.on('call', onCall);
  current.on('disconnected', () => {
    if (stopped || current.destroyed) return;
    scheduleRetry(() => { if (!current.destroyed && current.disconnected) current.reconnect(); });
  });
  current.on('error', (err) => {
    if (stopped) return;
    switch (err.type) {
      case 'unavailable-id':
        // El servidor aún no liberó el identificador: si ya estuvo abierto solo se
        // reintenta la reconexión (destruir el peer cortaría a los celulares).
        setStatus('connecting');
        if (current.destroyed) scheduleRetry(connect);
        else scheduleRetry(() => { if (!current.destroyed && current.disconnected) current.reconnect(); });
        break;
      case 'browser-incompatible':
      case 'invalid-id':
      case 'invalid-key':
      case 'ssl-unavailable':
        setStatus('error', err.type);
        break;
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed':
        setTimeout(() => setStatus('error', 'network'), 0);
        if (current.destroyed) scheduleRetry(connect);
        else scheduleRetry(() => { if (!current.destroyed && current.disconnected) current.reconnect(); });
        break;
      default:
        console.debug('[Capturazo]', err.type, err.message);
    }
  });
}

function scheduleRetry(fn) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(fn, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 15000);
}

function send(conn, msg) {
  try {
    if (conn?.open) conn.send(msg);
  } catch {}
}

// ---------------------------------------------------------------- estado compartido

function activeDevice() {
  return activeId ? devices.get(activeId) || null : null;
}

function publicDevices() {
  return [...devices.values()].map(({ id, name, since, stream, media }) => ({ id, name, since, streaming: !!stream, media }));
}

function publicConsumers() {
  return [...consumers.values()].filter((c) => c.joined).map(({ id, kind, origin, title, tabId }) => ({ id, kind, origin, title, tabId }));
}

// Lo que ven las páginas, el visor y el panel: si hay señal y cómo es.
function liveState() {
  const d = activeDevice();
  const media = d?.media || {};
  return {
    live: !!d?.stream,
    device: d?.name || '',
    cam: media.cam || null,
    mic: media.mic || null,
    rec: rec ? rec.since : 0,
    phones: devices.size,
  };
}

let syncTimer = 0;
function sync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    toSW({ type: 'sync', devices: publicDevices(), activeId, consumers: publicConsumers(), rec: rec ? { since: rec.since, device: rec.deviceId } : null });
    const state = liveState();
    for (const c of consumers.values()) if (c.joined) post(c, { t: 'state', state });
    const uses = publicConsumers().filter((c) => c.kind !== 'popup').map((c) => (c.kind === 'visor' ? 'Visor de Capturazo' : c.origin));
    for (const d of devices.values()) {
      send(d.conn, { t: 'status', live: d.id === activeId && !!d.stream, uses: [...new Set(uses)].slice(0, 6), rec: rec && rec.deviceId === d.id ? rec.since : 0, now: Date.now() });
    }
  }, 40);
}

// ---------------------------------------------------------------- celulares

function str(v, max = 80) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : '';
}

function int(v, min, max) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
}

function deviceName(raw) {
  return str(raw, 40) || 'Celular';
}

function onConnection(conn) {
  const device = { id: conn.connectionId, name: 'Celular', since: Date.now(), conn, peerId: conn.peer, authed: false, call: null, stream: null, sink: null, media: null, file: null };
  const authTimer = setTimeout(() => { if (!device.authed) conn.close(); }, 10000);

  conn.on('data', (raw) => {
    const msg = typeof raw === 'string' ? safeParse(raw) : raw;
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

    if (!device.authed) {
      if (msg.t === 'hello' && typeof msg.k === 'string' && msg.k === identity.token) {
        clearTimeout(authTimer);
        device.authed = true;
        device.name = deviceName(msg.name);
        devices.set(device.id, device);
        send(conn, { t: 'welcome', prefs: phonePrefs(), now: Date.now(), v: 1 });
        toSW({ type: 'joined', device: { id: device.id, name: device.name } });
        sync();
      } else {
        send(conn, { t: 'denied' });
        setTimeout(() => conn.close(), 300);
      }
      return;
    }
    onPhoneMessage(device, msg);
  });

  conn.on('close', () => {
    clearTimeout(authTimer);
    dropDevice(device);
  });
  conn.on('error', () => {});
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function phonePrefs() {
  return { quality: settings.quality || '720', fps: settings.fps || 30, micMode: settings.micMode === 'normal' ? 'normal' : 'nr', photoFormat: settings.photoFormat === 'png' ? 'png' : 'jpeg' };
}

function cleanMedia(m) {
  const facing = (v) => (v === 'user' || v === 'environment' ? v : '');
  const cam = m.cam && typeof m.cam === 'object'
    ? {
        id: str(m.cam.id, 200),
        label: str(m.cam.label),
        facing: facing(m.cam.facing),
        on: m.cam.on === true,
        w: int(m.cam.w, 0, 8192),
        h: int(m.cam.h, 0, 8192),
        fps: int(m.cam.fps, 0, 240),
        torch: typeof m.cam.torch === 'boolean' ? m.cam.torch : null,
      }
    : null;
  const mic = m.mic && typeof m.mic === 'object'
    ? { id: str(m.mic.id, 200), label: str(m.mic.label), on: m.mic.on === true, mode: m.mic.mode === 'normal' ? 'normal' : 'nr' }
    : null;
  const list = (arr, withFacing) => (Array.isArray(arr) ? arr.slice(0, 12) : [])
    .map((x) => (x && typeof x === 'object' ? { id: str(x.id, 200), label: str(x.label), ...(withFacing ? { facing: facing(x.facing) } : {}) } : null))
    .filter((x) => x && x.id);
  return { cam, mic, cams: list(m.cams, true), mics: list(m.mics, false), quality: ['480', '720', '1080'].includes(m.quality) ? m.quality : '' };
}

function onPhoneMessage(device, msg) {
  switch (msg.t) {
    case 'ping':
      send(device.conn, { t: 'pong', ts: Number(msg.ts) || 0 });
      return;
    case 'media':
      device.media = cleanMedia(msg);
      sync();
      return;
    case 'pref': {
      // Los cambios de calidad o de micrófono en el celular se guardan en la computadora.
      const patch = {};
      if (['480', '720', '1080'].includes(msg.quality)) patch.quality = msg.quality;
      if ([24, 30, 60].includes(msg.fps)) patch.fps = msg.fps;
      if (msg.micMode === 'nr' || msg.micMode === 'normal') patch.micMode = msg.micMode;
      if (Object.keys(patch).length) toSW({ type: 'prefs', patch });
      return;
    }
    case 'use':
      setActive(device.id);
      return;
    case 'rec':
      if (msg.on === true) startRecording(device.id).then((r) => send(device.conn, { t: 'done', what: 'rec', ok: r.ok, error: r.error || '' }));
      else stopRecording().then(() => send(device.conn, { t: 'done', what: 'recStop', ok: true }));
      return;
    case 'file':
      onFilePart(device, msg);
      return;
  }
}

function dropDevice(device) {
  if (!devices.delete(device.id)) return;
  try { device.call?.close(); } catch {}
  device.stream = null;
  if (device.sink) device.sink.srcObject = null;
  if (rec && rec.deviceId === device.id) stopRecording();
  toSW({ type: 'left', device: { id: device.id, name: device.name } });
  if (activeId === device.id) chooseActive();
  sync();
}

// ---------------------------------------------------------------- video y audio del celular

function onCall(call) {
  const device = [...devices.values()].find((d) => d.authed && d.peerId === call.peer);
  if (!device) {
    try { call.close(); } catch {}
    return;
  }
  if (device.call && device.call !== call) {
    try { device.call.close(); } catch {}
  }
  device.call = call;
  call.on('stream', (stream) => {
    if (device.call !== call) return;
    device.stream = stream;
    // Chrome solo entrega el audio de una conexión remota si algo lo reproduce: un
    // elemento silenciado basta para que la grabación y el reenvío lo reciban.
    device.sink ||= Object.assign(new Audio(), { muted: true });
    device.sink.srcObject = stream;
    device.sink.play().catch(() => {});
    if (!activeId || !activeDevice()?.stream) setActive(device.id);
    else sync();
  });
  call.on('close', () => {
    if (device.call !== call) return;
    device.call = null;
    device.stream = null;
    if (rec && rec.deviceId === device.id) stopRecording();
    if (activeId === device.id) chooseActive();
    sync();
  });
  call.on('error', () => {});
  call.answer(undefined, { sdpTransform: (sdp) => fastStart(sdp, PHONE_START) });
}

function chooseActive() {
  const next = [...devices.values()].find((d) => d.stream) || [...devices.values()][0] || null;
  setActive(next?.id ?? null);
}

function setActive(id) {
  if (id && !devices.has(id)) return;
  const changed = id !== activeId;
  activeId = id;
  if (changed) for (const c of consumers.values()) applySource(c);
  sync();
}

function activeTracks() {
  const stream = activeDevice()?.stream;
  return {
    video: stream?.getVideoTracks()[0] || null,
    audio: stream?.getAudioTracks()[0] || null,
  };
}

// ---------------------------------------------------------------- reparto local (páginas, visor y panel)

// Cada página que usa la cámara del celular abre un puerto con este documento y una
// conexión WebRTC local, sin servidores: el video no sale de la computadora.
let consumerSeq = 0;

function post(c, msg) {
  try { c.port.postMessage(msg); } catch {}
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== RELAY_PORT || port.sender?.id !== chrome.runtime.id) return;
  const sender = port.sender;
  const c = { id: ++consumerSeq, port, pc: null, video: null, audio: null, joined: false, kind: 'page', origin: '', title: '', tabId: sender.tab?.id ?? null };
  try {
    const url = new URL(sender.url || sender.origin || '');
    c.origin = url.protocol === 'chrome-extension:' ? '' : url.hostname;
  } catch {}
  c.title = str(sender.tab?.title || '', 120);
  consumers.set(c.id, c);
  port.onMessage.addListener((msg) => onConsumerMessage(c, msg));
  port.onDisconnect.addListener(() => dropConsumer(c));
});

function onConsumerMessage(c, msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'join':
      if (c.joined) return;
      c.joined = true;
      c.kind = ['page', 'visor', 'popup'].includes(msg.kind) ? msg.kind : 'page';
      if (c.kind !== 'page') c.origin = '';
      startRelay(c);
      sync();
      break;
    case 'answer':
      if (c.pc && msg.sdp?.type === 'answer' && typeof msg.sdp.sdp === 'string') {
        c.pc.setRemoteDescription({ type: 'answer', sdp: fastStart(msg.sdp.sdp) }).catch(() => restartRelay(c));
      }
      break;
    case 'ice':
      if (c.pc && msg.c) c.pc.addIceCandidate(msg.c).catch(() => {});
      break;
    case 'restart':
      restartRelay(c);
      break;
  }
}

async function startRelay(c) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  c.pc = pc;
  c.video = pc.addTransceiver('video', { direction: 'sendonly' });
  c.audio = pc.addTransceiver('audio', { direction: 'sendonly' });
  pc.onicecandidate = (e) => { if (e.candidate && c.pc === pc) post(c, { t: 'ice', c: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => {
    if (c.pc === pc && pc.connectionState === 'failed') restartRelay(c);
  };
  applySource(c);
  try {
    await pc.setLocalDescription(await pc.createOffer());
    if (c.pc !== pc) return;
    // Conexión local: se permite mucha más calidad que por internet.
    for (const [t, max] of [[c.video, 12_000_000], [c.audio, 256_000]]) {
      const params = t.sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = max;
      if (t === c.video) params.degradationPreference = 'maintain-resolution';
      await t.sender.setParameters(params).catch(() => {});
    }
    post(c, { t: 'offer', sdp: pc.localDescription.toJSON() });
    post(c, { t: 'state', state: liveState() });
  } catch (err) {
    console.debug('[Capturazo] reparto local', err);
  }
}

// Por defecto WebRTC empieza con poca calidad y la sube de a poco. Dentro de la misma
// computadora no hace falta: se arranca directamente con buena calidad.
const FAST_START = 'x-google-start-bitrate=6000;x-google-min-bitrate=2500;x-google-max-bitrate=12000';
// Celular → computadora: casi siempre es la misma red Wi-Fi; se empieza alto sin fijar un mínimo.
const PHONE_START = 'x-google-start-bitrate=2000';

function fastStart(sdp, params = FAST_START) {
  const nl = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(nl);
  const video = new Set();
  for (const l of lines) {
    const m = l.match(/^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\/90000/i);
    if (m) video.add(m[1]);
  }
  const withFmtp = new Set();
  const out = lines.map((l) => {
    const f = l.match(/^a=fmtp:(\d+) /);
    if (!f || !video.has(f[1])) return l;
    withFmtp.add(f[1]);
    return `${l};${params}`;
  });
  // Los códecs sin línea fmtp (VP8) la reciben justo después de su rtpmap.
  return out.flatMap((l) => {
    const m = l.match(/^a=rtpmap:(\d+) /);
    return m && video.has(m[1]) && !withFmtp.has(m[1]) ? [l, `a=fmtp:${m[1]} ${params}`] : [l];
  }).join(nl);
}

function restartRelay(c) {
  if (!consumers.has(c.id)) return;
  try { c.pc?.close(); } catch {}
  c.pc = null;
  post(c, { t: 'reset' });
  startRelay(c);
}

function applySource(c) {
  if (!c.pc) return;
  const { video, audio } = activeTracks();
  c.video.sender.replaceTrack(video).catch(() => {});
  c.audio.sender.replaceTrack(audio).catch(() => {});
}

function dropConsumer(c) {
  if (!consumers.delete(c.id)) return;
  try { c.pc?.close(); } catch {}
  c.pc = null;
  if (c.joined) sync();
}

// ---------------------------------------------------------------- fotos (llegan del celular en partes)

const MAX_PARTS = 1200; // ~14 MB en base64
const CHUNK_MAX = 16000;

function onFilePart(device, m) {
  if (!Number.isInteger(m.id) || !Number.isInteger(m.i) || !Number.isInteger(m.n) || typeof m.d !== 'string') return;
  if (m.n < 1 || m.n > MAX_PARTS || m.i < 0 || m.i >= m.n || m.d.length > CHUNK_MAX) return;
  if (m.i === 0) {
    const mime = m.mime === 'image/png' ? 'image/png' : m.mime === 'image/jpeg' ? 'image/jpeg' : '';
    if (!mime) return;
    clearTimeout(device.file?.timer);
    device.file = { id: m.id, n: m.n, parts: new Array(m.n), got: 0, mime, timer: setTimeout(() => { device.file = null; }, 30000) };
  }
  const f = device.file;
  if (!f || f.id !== m.id || f.n !== m.n || f.parts[m.i] != null) return;
  f.parts[m.i] = m.d;
  f.got++;
  if (f.got < f.n) return;
  clearTimeout(f.timer);
  device.file = null;
  try {
    const bin = atob(f.parts.join(''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: f.mime });
    const filename = `Capturazo/Foto ${stamp()}.${f.mime === 'image/png' ? 'png' : 'jpg'}`;
    download(blob, filename, 'photo');
    send(device.conn, { t: 'done', what: 'photo', ok: true });
  } catch {
    send(device.conn, { t: 'done', what: 'photo', ok: false });
  }
}

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}.${p(date.getMinutes())}.${p(date.getSeconds())}`;
}

function download(blob, filename, kind) {
  const url = URL.createObjectURL(blob);
  toSW({ type: 'download', url, filename, kind, size: blob.size });
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
}

// ---------------------------------------------------------------- grabación

let rec = null;

function recMime() {
  const mp4 = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];
  const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const order = settings.recFormat === 'webm' ? [...webm, ...mp4] : [...mp4, ...webm];
  return order.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

const REC_BITRATE = { 480: 2_500_000, 720: 5_000_000, 1080: 8_000_000 };

async function startRecording(id = activeId) {
  if (rec) return { ok: true, since: rec.since };
  const d = id ? devices.get(id) : null;
  if (!d?.stream) return { ok: false, error: 'no-source' };
  const tracks = d.stream.getTracks().filter((t) => t.readyState === 'live');
  if (!tracks.length) return { ok: false, error: 'no-source' };
  const mimeType = recMime();
  let recorder;
  try {
    recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType,
      videoBitsPerSecond: REC_BITRATE[settings.quality] || REC_BITRATE[720],
      audioBitsPerSecond: 160_000,
    });
  } catch {
    return { ok: false, error: 'recorder' };
  }
  const chunks = [];
  const current = { recorder, since: Date.now(), deviceId: d.id, done: null };
  current.done = new Promise((resolve) => {
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || 'video/webm';
      const blob = new Blob(chunks, { type });
      if (blob.size) download(blob, `Capturazo/Video ${stamp(new Date(current.since))}.${type.includes('mp4') ? 'mp4' : 'webm'}`, 'video');
      resolve();
    };
  });
  recorder.start(1000);
  rec = current;
  sync();
  return { ok: true, since: current.since };
}

async function stopRecording() {
  const current = rec;
  if (!current) return { ok: true };
  rec = null;
  try { current.recorder.stop(); } catch {}
  await current.done;
  sync();
  return { ok: true };
}

// ---------------------------------------------------------------- mensajes del service worker

function reply(promise, sendResponse) {
  Promise.resolve(promise).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
}

function target(id) {
  return (id && devices.get(id)) || activeDevice();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.to !== 'offscreen' || sender.id !== chrome.runtime.id) return;
  switch (msg.type) {
    case 'settings': {
      const before = settings;
      settings = msg.settings || {};
      const prefs = phonePrefs();
      if (before.quality !== settings.quality || before.fps !== settings.fps || before.micMode !== settings.micMode || before.photoFormat !== settings.photoFormat) {
        for (const d of devices.values()) send(d.conn, { t: 'prefs', prefs });
      }
      break;
    }
    case 'phone': {
      // Control remoto desde la computadora: cámara, micrófono, linterna y calidad.
      const d = target(msg.id);
      if (!d) { sendResponse({ ok: false, error: 'no-phone' }); break; }
      const set = {};
      const s = msg.set || {};
      if (typeof s.cam === 'string' && s.cam.length <= 200) set.cam = s.cam;
      if (s.flip === true) set.flip = true;
      for (const k of ['camOn', 'micOn', 'torch']) if (typeof s[k] === 'boolean') set[k] = s[k];
      if (s.mode === 'nr' || s.mode === 'normal') set.mode = s.mode;
      send(d.conn, { t: 'set', ...set });
      sendResponse({ ok: true });
      break;
    }
    case 'snap': {
      const d = target(msg.id);
      if (!d?.stream) { sendResponse({ ok: false, error: 'no-source' }); break; }
      send(d.conn, { t: 'snap' });
      sendResponse({ ok: true });
      break;
    }
    case 'use':
      setActive(msg.id);
      sendResponse({ ok: true });
      break;
    case 'rec:start':
      return reply(startRecording(), sendResponse);
    case 'rec:stop':
      return reply(stopRecording(), sendResponse);
    case 'kick': {
      const d = devices.get(msg.id);
      if (d) {
        send(d.conn, { t: 'bye', reason: 'kicked' });
        setTimeout(() => d.conn.close(), 200);
      }
      break;
    }
    case 'stop':
      stopped = true;
      clearTimeout(retryTimer);
      for (const d of devices.values()) send(d.conn, { t: 'bye', reason: msg.reason || 'stopped' });
      for (const c of consumers.values()) post(c, { t: 'bye' });
      // Si se estaba grabando, el video se guarda antes de cerrar.
      Promise.all([stopRecording(), new Promise((r) => setTimeout(r, 250))]).then(() => {
        try { peer?.destroy(); } catch {}
        sendResponse({ ok: true });
      });
      return true;
  }
});

// ---------------------------------------------------------------- retransmisión (TURN)

async function loadIce() {
  if (!ICE_ENDPOINT) return FALLBACK_ICE;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(ICE_ENDPOINT, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (!Array.isArray(data.iceServers) || !data.iceServers.length) throw new Error('sin servidores');
    return { iceServers: data.iceServers };
  } catch (err) {
    console.debug('[Capturazo] retransmisión no disponible:', err.message);
    return FALLBACK_ICE;
  } finally {
    clearTimeout(timer);
  }
}

setInterval(async () => {
  iceConfig = await loadIce();
  if (peer && !peer.destroyed) peer.options.config = iceConfig;
}, ICE_REFRESH_MS);

// ---------------------------------------------------------------- inicio

(async () => {
  identity = await toSW({ type: 'identity' });
  if (!identity?.peerId) {
    setStatus('error', 'identity');
    return;
  }
  const boot = await toSW({ type: 'offscreen:ready' });
  settings = boot?.settings || {};
  iceConfig = await loadIce();
  connect();
})();
