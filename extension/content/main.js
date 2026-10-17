// Capturazo — cámara y micrófono del celular dentro de la página (mundo principal).
// Agrega «Capturazo · Cámara del celular» y «Capturazo · Micrófono del celular» a la
// lista de dispositivos del sitio. Si la página los elige, entrega pistas propias que
// se alimentan con la señal del celular (o con una imagen de espera mientras no hay
// señal), así la videollamada no se corta si el celular se reconecta o cambia de cámara.

(() => {
  'use strict';
  const MD = globalThis.MediaDevices?.prototype;
  const MARK = Symbol.for('capturazo');
  if (!MD || !navigator.mediaDevices || MD.enumerateDevices[MARK]) return;

  const CAM_ID = 'capturazo-camara';
  const MIC_ID = 'capturazo-microfono';
  const GROUP = 'capturazo';
  const CAM_LABEL = 'Capturazo · Cámara del celular';
  const MIC_LABEL = 'Capturazo · Micrófono del celular';
  const EV = 'capturazo:';

  // Referencias propias: la página puede reemplazar estas funciones después.
  const nativeEnumerate = MD.enumerateDevices;
  const nativeGetUserMedia = MD.getUserMedia;
  const nativeStop = MediaStreamTrack.prototype.stop;
  const nativeSettings = MediaStreamTrack.prototype.getSettings;
  const dispatch = EventTarget.prototype.dispatchEvent;
  const listen = EventTarget.prototype.addEventListener;
  const parse = JSON.parse;
  const stringify = JSON.stringify;
  const now = () => performance.now();
  const doc = document;

  const HAS_GENERATOR = typeof globalThis.MediaStreamTrackGenerator === 'function' && typeof globalThis.MediaStreamTrackProcessor === 'function';

  let source = null; // MediaStream con la señal del celular (llega del mundo aislado)
  let state = null; // { live, device, cam, mic, rec, phones } o null sin sesión
  let bridge = false; // el mundo aislado está listo
  const outputs = new Set();

  const emit = (name, detail) => dispatch.call(doc, new CustomEvent(EV + name, detail === undefined ? undefined : { detail: stringify(detail) }));
  const read = (e) => { try { return parse(e.detail); } catch { return null; } };

  listen.call(doc, EV + 'stream', (e) => {
    const stream = e.relatedTarget?.srcObject;
    if (!(stream instanceof MediaStream)) return;
    source = stream;
    for (const out of outputs) connectOutput(out);
  });
  listen.call(doc, EV + 'state', (e) => {
    state = read(e);
    for (const out of outputs) connectOutput(out);
  });
  listen.call(doc, EV + 'ready', () => {
    bridge = true;
    if (outputs.size) emit('need');
  });

  // ---------------------------------------------------------------- preferencias (del mundo aislado)

  let askSeq = 0;
  const asks = new Map();
  listen.call(doc, EV + 'answer', (e) => {
    const v = read(e);
    const done = asks.get(v?.id);
    if (done) { asks.delete(v.id); done(v); }
  });

  function ask() {
    if (!bridge) return Promise.resolve({});
    return new Promise((resolve) => {
      const id = ++askSeq;
      const timer = setTimeout(() => { asks.delete(id); resolve({}); }, 800);
      asks.set(id, (v) => { clearTimeout(timer); resolve(v); });
      emit('ask', { id });
    });
  }

  // ---------------------------------------------------------------- dispositivos

  const CAM_CAPS = { deviceId: CAM_ID, groupId: GROUP, width: { min: 1, max: 1920 }, height: { min: 1, max: 1920 }, aspectRatio: { min: 0.5, max: 2 }, frameRate: { min: 1, max: 60 }, facingMode: [], resizeMode: ['none'] };
  const MIC_CAPS = { deviceId: MIC_ID, groupId: GROUP, channelCount: { min: 1, max: 2 }, sampleRate: { min: 48000, max: 48000 }, sampleSize: { min: 16, max: 16 }, echoCancellation: [true, false], noiseSuppression: [true, false], autoGainControl: [true, false] };

  function fakeDevice(kind, deviceId, label, caps) {
    const Info = kind.endsWith('input') && typeof globalThis.InputDeviceInfo === 'function' ? globalThis.InputDeviceInfo : globalThis.MediaDeviceInfo;
    const info = Object.create(Info.prototype);
    const json = { deviceId, kind, label, groupId: GROUP };
    Object.defineProperties(info, {
      deviceId: { value: deviceId, enumerable: true },
      kind: { value: kind, enumerable: true },
      label: { value: label, enumerable: true },
      groupId: { value: GROUP, enumerable: true },
      toJSON: { value: () => ({ ...json }) },
      getCapabilities: { value: () => ({ ...caps }) },
    });
    return info;
  }

  const CAM_DEVICE = fakeDevice('videoinput', CAM_ID, CAM_LABEL, CAM_CAPS);
  const MIC_DEVICE = fakeDevice('audioinput', MIC_ID, MIC_LABEL, MIC_CAPS);

  function insertAfterKind(list, device) {
    let at = -1;
    list.forEach((d, i) => { if (d.kind === device.kind) at = i; });
    // Sin dispositivos de ese tipo (una computadora sin cámara): el celular es el único.
    if (at < 0) list.splice(device.kind === 'audioinput' ? 0 : list.length, 0, device);
    else list.splice(at + 1, 0, device);
  }

  async function enumerateDevices() {
    const list = [...(await nativeEnumerate.call(this))];
    insertAfterKind(list, MIC_DEVICE);
    insertAfterKind(list, CAM_DEVICE);
    return list;
  }

  // ¿La restricción pide este dispositivo? (deviceId como texto, lista, exact o ideal)
  function wants(constraint, id) {
    if (!constraint || typeof constraint !== 'object') return false;
    const has = (x) => x === id || (Array.isArray(x) && x.includes(id));
    const check = (c) => {
      const d = c?.deviceId;
      if (has(d)) return true;
      return !!d && typeof d === 'object' && (has(d.exact) || has(d.ideal));
    };
    return check(constraint) || (Array.isArray(constraint.advanced) && constraint.advanced.some(check));
  }

  const generic = (c) => c === true || (!!c && typeof c === 'object' && c.deviceId == null && !(Array.isArray(c.advanced) && c.advanced.some((a) => a?.deviceId != null)));

  async function getUserMedia(constraints) {
    const c = constraints && typeof constraints === 'object' ? constraints : {};
    let cam = wants(c.video, CAM_ID);
    let mic = wants(c.audio, MIC_ID);

    if (!cam && !mic) {
      // «Preferir el celular»: si el sitio no eligió un dispositivo y el celular está transmitiendo.
      if (generic(c.video) || generic(c.audio)) {
        const prefs = await ask();
        if (prefs.preferPhone && prefs.live) {
          cam = generic(c.video);
          mic = generic(c.audio);
        }
      }
    }

    if (!cam && !mic) {
      try {
        return await nativeGetUserMedia.call(this, constraints);
      } catch (err) {
        // Computadora sin cámara (o sin micrófono): se ofrece el celular en su lugar.
        if (!['NotFoundError', 'NotReadableError', 'OverconstrainedError'].includes(err?.name) || !(c.video || c.audio)) throw err;
        const prefs = await ask();
        if (!prefs.fallbackPhone) throw err;
        const tracks = [];
        if (c.video) tracks.push(createOutput('video'));
        if (c.audio) {
          try {
            tracks.push(...(await nativeGetUserMedia.call(this, { audio: c.audio })).getAudioTracks());
          } catch {
            tracks.push(createOutput('audio'));
          }
        }
        return new MediaStream(tracks);
      }
    }

    const tracks = [];
    if (cam) tracks.push(createOutput('video'));
    if (mic) tracks.push(createOutput('audio'));
    const rest = {};
    if (c.video && !cam) rest.video = c.video;
    if (c.audio && !mic) rest.audio = c.audio;
    if (rest.video || rest.audio) {
      try {
        tracks.push(...(await nativeGetUserMedia.call(this, rest)).getTracks());
      } catch (err) {
        for (const t of tracks) t.stop();
        throw err;
      }
    }
    return new MediaStream(tracks);
  }

  // ---------------------------------------------------------------- pistas propias

  function define(obj, key, value) {
    Object.defineProperty(obj, key, { value, configurable: true, writable: true });
  }

  function dress(track, kind) {
    const isCam = kind === 'video';
    Object.defineProperty(track, 'label', { get: () => (isCam ? CAM_LABEL : MIC_LABEL), configurable: true });
    define(track, 'getSettings', function getSettings() {
      const base = nativeSettings.call(this) || {};
      if (isCam) {
        const w = state?.cam?.w || 1280;
        const h = state?.cam?.h || 720;
        return { ...base, deviceId: CAM_ID, groupId: GROUP, width: w, height: h, aspectRatio: Math.round((w / h) * 1000) / 1000, frameRate: state?.cam?.fps || 30, resizeMode: 'none' };
      }
      const nr = state?.mic?.mode !== 'normal';
      return { ...base, deviceId: MIC_ID, groupId: GROUP, channelCount: 1, sampleRate: 48000, sampleSize: 16, echoCancellation: nr, noiseSuppression: nr, autoGainControl: nr };
    });
    define(track, 'getCapabilities', () => ({ ...(isCam ? CAM_CAPS : MIC_CAPS) }));
    define(track, 'getConstraints', () => ({ deviceId: { exact: isCam ? CAM_ID : MIC_ID } }));
    define(track, 'applyConstraints', () => Promise.resolve());
  }

  function createOutput(kind) {
    if (!HAS_GENERATOR) throw new DOMException('Capturazo necesita una versión más reciente de Chrome.', 'NotReadableError');
    const gen = new globalThis.MediaStreamTrackGenerator({ kind });
    const out = { kind, gen, writer: gen.writable.getWriter(), pump: null, ended: false, lastFrame: 0, ts: 0, ticker: 0 };
    dress(gen, kind);
    define(gen, 'stop', function stop() {
      endOutput(out);
      return nativeStop.call(this);
    });
    outputs.add(out);
    if (kind === 'video') {
      out.ticker = setInterval(() => tick(out), 250);
      tick(out);
    }
    emit('need');
    connectOutput(out);
    return gen;
  }

  function endOutput(out) {
    if (out.ended) return;
    out.ended = true;
    clearInterval(out.ticker);
    stopPump(out);
    try { out.writer.releaseLock(); } catch {}
    outputs.delete(out);
    if (!outputs.size) emit('release');
  }

  const camOn = () => !!state?.live && state.cam?.on !== false;
  const micOn = () => !!state?.live && state.mic?.on !== false;

  function connectOutput(out) {
    if (out.ended) return;
    const on = out.kind === 'video' ? camOn() : micOn();
    const track = on ? (out.kind === 'video' ? source?.getVideoTracks()[0] : source?.getAudioTracks()[0]) : null;
    if (out.pump && out.pump.source === track) return;
    stopPump(out);
    if (track && track.readyState === 'live') startPump(out, track);
  }

  function stopPump(out) {
    const pump = out.pump;
    if (!pump) return;
    out.pump = null;
    pump.stop = true;
    pump.reader.cancel().catch(() => {});
    try { nativeStop.call(pump.clone); } catch {}
  }

  async function startPump(out, track) {
    const clone = track.clone();
    const reader = new globalThis.MediaStreamTrackProcessor({ track: clone }).readable.getReader();
    const pump = { source: track, clone, reader, stop: false };
    out.pump = pump;
    try {
      while (!pump.stop && !out.ended) {
        const { value, done } = await reader.read();
        if (done) break;
        if (pump.stop || out.ended) { value.close(); break; }
        let frame = null;
        try {
          frame = out.kind === 'video' ? new VideoFrame(value, { timestamp: videoTime(out) }) : copyAudio(out, value);
        } catch {
          frame = null;
        } finally {
          value.close();
        }
        if (!frame) continue;
        out.lastFrame = now();
        try {
          await out.writer.write(frame);
        } catch {
          frame.close();
          endOutput(out);
          break;
        }
      }
    } catch {}
    if (out.pump === pump) out.pump = null;
  }

  // Marcas de tiempo propias y siempre crecientes: al pasar de la imagen de espera a la
  // señal (o de un celular a otro) los programas de video no ven saltos hacia atrás.
  function videoTime(out) {
    const t = Math.round(now() * 1000);
    out.ts = Math.max(t, out.ts + 1);
    return out.ts;
  }

  function copyAudio(out, a) {
    const planar = a.format.endsWith('-planar');
    const planes = planar ? a.numberOfChannels : 1;
    const sizes = [];
    let total = 0;
    for (let p = 0; p < planes; p++) {
      const s = a.allocationSize({ planeIndex: p });
      sizes.push(s);
      total += s;
    }
    const buf = new ArrayBuffer(total);
    let offset = 0;
    for (let p = 0; p < planes; p++) {
      a.copyTo(new Uint8Array(buf, offset, sizes[p]), { planeIndex: p });
      offset += sizes[p];
    }
    const t = Math.round(now() * 1000);
    if (out.ts < t - 200000) out.ts = t; // hubo un hueco: se retoma desde ahora
    const timestamp = out.ts;
    out.ts += Math.round((a.numberOfFrames / a.sampleRate) * 1e6);
    return new AudioData({ format: a.format, sampleRate: a.sampleRate, numberOfFrames: a.numberOfFrames, numberOfChannels: a.numberOfChannels, timestamp, data: buf });
  }

  // ---------------------------------------------------------------- imagen de espera

  let canvas = null;
  let paintedFor = '';

  function waitMessage() {
    if (!state) return ['Conecta tu celular', 'Abre Capturazo en Chrome y escanea el código QR'];
    if (!state.live) return ['Esperando al celular…', 'Escanea el código QR del panel de Capturazo'];
    if (state.cam?.on === false) return ['Cámara apagada', `La cámara de ${state.device || 'tu celular'} está apagada`];
    return ['Conectando…', state.device || 'Celular'];
  }

  function paint([title, body]) {
    const W = 1280;
    const H = 720;
    canvas ||= new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const bg = ctx.createRadialGradient(W / 2, H * 1.05, 40, W / 2, H * 0.7, W * 0.75);
    bg.addColorStop(0, '#0b2a3d');
    bg.addColorStop(1, '#0b0b0c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // Lente del logo
    const cx = W / 2;
    const cy = H / 2 - 70;
    ctx.fillStyle = '#1c1c21';
    ctx.beginPath(); ctx.arc(cx, cy, 64, 0, Math.PI * 2); ctx.fill();
    const lens = ctx.createLinearGradient(cx - 46, cy - 46, cx + 46, cy + 46);
    lens.addColorStop(0, '#7debff');
    lens.addColorStop(1, '#0a84ff');
    ctx.fillStyle = lens;
    ctx.beginPath(); ctx.arc(cx, cy, 46, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#061423';
    ctx.beginPath(); ctx.arc(cx, cy, 21, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath(); ctx.arc(cx - 15, cy - 15, 8, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f5f5f7';
    ctx.font = '600 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
    ctx.fillText(title, cx, cy + 140);
    ctx.fillStyle = '#8e8e93';
    ctx.font = '28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
    ctx.fillText(body, cx, cy + 190);
    ctx.fillStyle = '#5a5a60';
    ctx.font = '600 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
    ctx.fillText('CAPTURAZO', cx, H - 48);
  }

  function tick(out) {
    if (out.ended || now() - out.lastFrame < 1200) return;
    const msg = waitMessage();
    const key = msg.join('|');
    if (key !== paintedFor || !canvas) {
      paint(msg);
      paintedFor = key;
    }
    let frame;
    try {
      frame = new VideoFrame(canvas, { timestamp: videoTime(out) });
    } catch {
      return;
    }
    out.writer.write(frame).catch(() => {
      frame.close();
      endOutput(out);
    });
  }

  // ---------------------------------------------------------------- instalación

  const mark = (fn) => {
    Object.defineProperty(fn, MARK, { value: true });
    return fn;
  };
  MD.enumerateDevices = mark(enumerateDevices);
  MD.getUserMedia = mark(getUserMedia);

  emit('hello');

  // Insertado con la página ya abierta (al permitir el sitio): se avisa que cambió la
  // lista de dispositivos para que el sitio muestre el celular sin recargar.
  if (doc.readyState !== 'loading') {
    try { navigator.mediaDevices.dispatchEvent(new Event('devicechange')); } catch {}
  }
})();
