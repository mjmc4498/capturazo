// Capturazo — cámara y micrófono en el celular.
// Se conecta por WebRTC (PeerJS) con la extensión de Chrome y le envía la cámara y el
// micrófono elegidos. La computadora los usa como cámara y micrófono en sus páginas,
// los muestra en el visor y guarda fotos y videos.

/* global Peer */
(() => {
  'use strict';

  const VERSION = '1.0.0';

  // Worker de Cloudflare que entrega credenciales temporales de retransmisión (TURN)
  // para redes que bloquean la conexión directa.
  const ICE_ENDPOINT = 'https://mando-turn.mjmc4498.workers.dev/ice';
  const FALLBACK_ICE = {
    iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }],
  };
  const ICE_REFRESH_MS = 3 * 60 * 60 * 1000;
  const CHUNK = 12000;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const app = $('#app');

  // ================================================================ textos

  const TEXT = {
    settings: 'Ajustes', retry: 'Reintentar', done: 'Listo', privacy: 'Privacidad', madeBy: 'Creado por Miguel Mogrovejo',
    haptics: 'Vibración', keepAwake: 'Mantener la pantalla encendida', mirror: 'Vista previa en espejo', latency: 'Latencia',
    forget: 'Olvidar esta computadora', quality: 'Calidad del video', fps: 'Cuadros por segundo', micDevice: 'Micrófono',
    connected: 'Conectado', connecting: 'Conectando…', reconnecting: 'Reconectando…', offline: 'Sin conexión',
    gateIdleTitle: 'Escanea el código', gateIdleBody: 'Abre la extensión Capturazo en Chrome y escanea el código QR con la cámara de tu celular.',
    gateConnectingTitle: 'Conectando…', gateConnectingBody: 'Buscando tu computadora.',
    gateWaitingTitle: 'Esperando a la computadora', gateWaitingBody: 'Abre el panel de Capturazo en Chrome. Si muestra un código nuevo, escanéalo otra vez.',
    gateOfflineTitle: 'Sin conexión', gateOfflineBody: 'Revisa la conexión a internet de tu celular.',
    gateDeniedTitle: 'Código no válido', gateDeniedBody: 'Este código fue renovado. Escanea el código nuevo desde la extensión.',
    gateEndedTitle: 'Sesión finalizada', gateEndedBody: 'La sesión se detuvo en la computadora. Si al volver a iniciarla aparece un código nuevo, escanéalo.',
    gateKickedTitle: 'Desconectado', gateKickedBody: 'La computadora cerró la conexión con este celular.',
    gateUnsupportedTitle: 'Navegador no compatible', gateUnsupportedBody: 'Abre este enlace en Chrome o Safari actualizados.',
    startTitle: 'Tu celular está conectado', startBody: 'Toca «Empezar» y permite el acceso a la cámara y al micrófono. Tu computadora los usará como si fueran suyos.',
    start: 'Empezar', startDenied: 'El navegador no dio acceso a la cámara ni al micrófono. Permítelo en los ajustes del sitio y vuelve a intentarlo.',
    startInsecure: 'La cámara solo funciona en una dirección segura (https).',
    camOff: 'Cámara apagada', mic: 'Micrófono', camera: 'Cámara', flip: 'Girar', photo: 'Foto', record: 'Grabar', stopRec: 'Detener',
    modeNormal: 'Normal', modeNr: 'Reducción de ruido', micMode: 'Modo del micrófono', cameras: 'Cámaras', torch: 'Linterna',
    onAir: 'Transmitiendo', inUse: 'En uso', standby: 'En espera', useThis: 'Usar este celular',
    front: 'Frontal', back: 'Trasera', wide: 'Gran angular', ultraWide: 'Ultra gran angular', tele: 'Teleobjetivo', cameraN: 'Cámara',
    photoSaved: 'Foto guardada en la computadora', photoFailed: 'No se pudo guardar la foto', recStarted: 'Grabando en la computadora',
    recSaved: 'Video guardado en la computadora', recFailed: 'No se pudo grabar', noCamera: 'Enciende la cámara para tomar fotos',
    camFailed: 'No se pudo abrir esa cámara', micFailed: 'No se pudo abrir el micrófono', notConnected: 'Sin conexión con la computadora',
    modeNrOn: 'Reducción de ruido activada', modeNormalOn: 'Micrófono normal', camPicked: 'Cámara', camBusy: 'Otra app está usando la cámara',
  };
  const t = (key) => TEXT[key] ?? key;

  document.documentElement.lang = 'es';
  for (const el of $$('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of $$('[data-t-aria]')) el.setAttribute('aria-label', t(el.dataset.tAria));
  $('#version').textContent = VERSION;

  // ================================================================ preferencias

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(`capturazo.${key}`);
        return raw == null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(key, value) {
      try {
        if (value == null) localStorage.removeItem(`capturazo.${key}`);
        else localStorage.setItem(`capturazo.${key}`, JSON.stringify(value));
      } catch {}
    },
  };

  const prefs = { haptics: true, wake: true, mirror: true, camId: '', facing: 'user', micId: '', ...store.get('prefs', {}) };
  const savePrefs = () => store.set('prefs', prefs);

  // Lo que decide la computadora (y se guarda allá): calidad, cuadros y modo del micrófono.
  let media = { quality: '720', fps: 30, micMode: 'nr', photoFormat: 'jpeg' };

  // ================================================================ utilidades

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // Vibración: navigator.vibrate en Android; en iOS 18+ un interruptor nativo produce un toque háptico.
  const hapticSwitch = (() => {
    if (!isIOS) return null;
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.append(input);
    label.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none;left:-10px;top:-10px';
    label.setAttribute('aria-hidden', 'true');
    document.body.append(label);
    return label;
  })();

  function buzz(pattern = 10) {
    if (!prefs.haptics) return;
    if (navigator.vibrate) navigator.vibrate(pattern);
    else if (hapticSwitch) hapticSwitch.click();
  }

  let toastTimer = 0;
  function toast(text, { error = false } = {}) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.toggle('error', error);
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), error ? 3600 : 2200);
  }

  function deviceName() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua) || isIOS) return 'iPad';
    const m = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/);
    if (m && m[1] && !/^K$|wv/.test(m[1])) return m[1].trim().slice(0, 32);
    if (/Android/.test(ua)) return 'Android';
    return 'Navegador';
  }

  const fmtClock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  // ================================================================ sesión

  const query = new URLSearchParams(location.search);
  const demo = query.has('demo');
  const hash = new URLSearchParams(location.hash.slice(1));
  let session = null;
  if (hash.get('id') && hash.get('k')) {
    session = { id: hash.get('id'), k: hash.get('k') };
    store.set('session', session);
    // La clave no debe quedar en la barra de direcciones ni en el historial.
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    session = store.get('session', null);
  }

  let peer = null;
  let conn = null;
  let call = null;
  let connState = 'connecting';
  let everConnected = false;
  let retryTimer = 0;
  let retryDelay = 1200;
  let pingTimer = 0;
  let lastPong = 0;
  let latency = 0;
  let clockOffset = 0;
  let status = { live: false, uses: [], rec: 0 };

  // ================================================================ cámara y micrófono

  const preview = $('#preview');
  let started = false;
  let camTrack = null;
  let micTrack = null;
  let camOn = true;
  let micOn = true;
  let cams = [];
  let mics = [];
  let torchOn = false;
  let busy = Promise.resolve();
  let fillers = null;

  const SIZES = { 480: [854, 480], 720: [1280, 720], 1080: [1920, 1080] };
  const BITRATE = { 480: 1_200_000, 720: 2_500_000, 1080: 4_500_000 };

  // Una sola operación de cámara o micrófono a la vez (en iOS abrir una cámara cierra la otra).
  function serial(fn) {
    const next = busy.then(fn, fn);
    busy = next.catch(() => {});
    return next;
  }

  function videoConstraints(extra = {}) {
    const [w, h] = SIZES[media.quality] || SIZES[720];
    // En vertical el navegador entrega el video girado: se piden los lados como «ideales».
    return { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: media.fps || 30, max: Math.max(30, media.fps || 30) }, ...extra };
  }

  function audioConstraints(extra = {}) {
    const nr = media.micMode !== 'normal';
    return { echoCancellation: nr, noiseSuppression: nr, autoGainControl: nr, channelCount: { ideal: 1 }, ...extra };
  }

  function camSelector() {
    if (prefs.camId && cams.some((c) => c.id === prefs.camId)) return { deviceId: { exact: prefs.camId } };
    if (prefs.camId && !cams.length) return { deviceId: prefs.camId };
    return { facingMode: prefs.facing === 'environment' ? 'environment' : 'user' };
  }

  function micSelector() {
    return prefs.micId && mics.some((m) => m.id === prefs.micId) ? { deviceId: { exact: prefs.micId } } : {};
  }

  // Pistas de relleno: la llamada necesita una pista de cada tipo desde el inicio para
  // poder cambiarla después sin renegociar.
  function getFillers() {
    if (fillers) return fillers;
    const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 180 });
    const g = canvas.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, 320, 180);
    const video = canvas.captureStream ? canvas.captureStream(1).getVideoTracks()[0] : null;
    let audio = null;
    try {
      audio = audioCtx().createMediaStreamDestination().stream.getAudioTracks()[0];
    } catch {}
    fillers = { video, audio };
    return fillers;
  }

  let ctx = null;
  function audioCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function camLabel(track) {
    const s = track?.getSettings?.() || {};
    const found = cams.find((c) => c.id === s.deviceId);
    return found?.label || '';
  }

  function nameCamera(label, facing) {
    const l = label || '';
    if (/ultra ?wide|ultra ?gran/i.test(l)) return t('ultraWide');
    if (/tele/i.test(l)) return t('tele');
    if (/wide|gran angular/i.test(l) && /back|rear|trasera|environment/i.test(l)) return t('wide');
    if (facing === 'user' || /facing front|front|frontal|delantera|user/i.test(l)) return t('front');
    if (facing === 'environment' || /facing back|back|rear|trasera|environment/i.test(l)) return t('back');
    return l.replace(/\s*\([^)]*\)\s*$/, '').slice(0, 26) || t('cameraN');
  }

  async function refreshDevices() {
    let list = [];
    try { list = await navigator.mediaDevices.enumerateDevices(); } catch {}
    // Las cámaras de Capturazo (si esta página se abre en una computadora con la extensión) no cuentan.
    list = list.filter((d) => !d.deviceId.startsWith('capturazo-'));
    const videos = list.filter((d) => d.kind === 'videoinput' && d.deviceId);
    const named = videos.map((d, i) => {
      const facing = /facing front|front|frontal|delantera/i.test(d.label) ? 'user' : /facing back|back|rear|trasera/i.test(d.label) ? 'environment' : '';
      return { id: d.deviceId, raw: d.label, facing, label: nameCamera(d.label, facing) || `${t('cameraN')} ${i + 1}` };
    });
    // Nombres repetidos (Android: varias «Trasera») → «Trasera 2», «Trasera 3»…
    const seen = new Map();
    for (const c of named) {
      const n = (seen.get(c.label) || 0) + 1;
      seen.set(c.label, n);
      if (n > 1) c.label = `${c.label} ${n}`;
    }
    const rank = (c) => (c.facing === 'user' ? 0 : c.facing === 'environment' ? 1 : 2);
    cams = named.sort((a, b) => rank(a) - rank(b));
    mics = list.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: (d.label || `${t('micDevice')} ${i + 1}`).slice(0, 40) }));
    renderCams();
    renderMics();
  }

  async function openCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(camSelector()), audio: false });
    return stream.getVideoTracks()[0];
  }

  async function openMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(micSelector()), video: false });
    return stream.getAudioTracks()[0];
  }

  function adoptCam(track) {
    camTrack = track;
    if (track) {
      track.contentHint = 'motion';
      track.addEventListener('ended', () => {
        if (camTrack !== track) return;
        camTrack = null;
        replace('video', null);
        renderMedia();
        sendMedia();
      });
      const s = track.getSettings?.() || {};
      if (s.facingMode === 'user' || s.facingMode === 'environment') prefs.facing = s.facingMode;
      if (s.deviceId) prefs.camId = s.deviceId;
      savePrefs();
    }
    preview.srcObject = track ? new MediaStream([track]) : null;
    if (track) preview.play().catch(() => {});
    torchOn = false;
  }

  function adoptMic(track) {
    micTrack = track;
    if (track) {
      track.contentHint = media.micMode === 'normal' ? 'music' : 'speech';
      track.addEventListener('ended', () => {
        if (micTrack !== track) return;
        micTrack = null;
        replace('audio', null);
        meterSource(null);
        renderMedia();
        sendMedia();
      });
    }
    meterSource(track);
  }

  async function startMedia() {
    if (!navigator.mediaDevices?.getUserMedia) {
      showStartError(window.isSecureContext ? t('startDenied') : t('startInsecure'));
      return;
    }
    audioCtx();
    $('#start-btn').disabled = true;
    try {
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(camSelector()), audio: audioConstraints() });
      } catch (err) {
        // El id guardado puede haber cambiado (otro navegador o se borraron los datos).
        if (err?.name === 'OverconstrainedError' && prefs.camId) {
          prefs.camId = '';
          stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(camSelector()), audio: audioConstraints() });
        } else if (err?.name === 'NotFoundError' || err?.name === 'NotReadableError') {
          // Sin cámara (o en uso): se sigue solo con el micrófono, o al revés.
          stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() }).catch(() => null)
            || await navigator.mediaDevices.getUserMedia({ video: videoConstraints(camSelector()) });
        } else {
          throw err;
        }
      }
      adoptCam(stream.getVideoTracks()[0] || null);
      adoptMic(stream.getAudioTracks()[0] || null);
      camOn = !!camTrack;
      micOn = !!micTrack;
      started = true;
      $('#start').hidden = true;
      await refreshDevices();
      renderMedia();
      keepAwake();
      callHost();
      sendMedia();
      buzz(20);
    } catch (err) {
      showStartError(t('startDenied'));
      console.debug('[Capturazo]', err);
    } finally {
      $('#start-btn').disabled = false;
    }
  }

  function showStartError(text) {
    const el = $('#start-err');
    el.textContent = text;
    el.hidden = false;
  }

  function setCamera(id) {
    return serial(async () => {
      if (!started) return;
      const before = { camId: prefs.camId, facing: prefs.facing };
      const cam = cams.find((c) => c.id === id);
      if (cam) {
        prefs.camId = cam.id;
        if (cam.facing) prefs.facing = cam.facing;
      }
      camTrack?.stop();
      camTrack = null;
      try {
        adoptCam(await openCamera());
        camOn = true;
      } catch (err) {
        toast(err?.name === 'NotReadableError' ? t('camBusy') : t('camFailed'), { error: true });
        Object.assign(prefs, before);
        try { adoptCam(await openCamera()); } catch { adoptCam(null); camOn = false; }
      }
      replace('video', camOn ? camTrack : null);
      renderMedia();
      sendMedia();
    });
  }

  function flip() {
    if (cams.length > 1) {
      const current = cams.find((c) => c.id === prefs.camId);
      const now = camTrack?.getSettings?.().facingMode || current?.facing || prefs.facing;
      const facing = now === 'user' ? 'environment' : 'user';
      const next = cams.find((c) => c.facing === facing && c !== current) || cams[(cams.indexOf(current) + 1) % cams.length];
      return setCamera(next.id);
    }
    prefs.facing = prefs.facing === 'user' ? 'environment' : 'user';
    prefs.camId = '';
    return setCamera('');
  }

  function setCamOn(on) {
    return serial(async () => {
      if (!started || on === camOn) return;
      if (!on) {
        camTrack?.stop();
        adoptCam(null);
        camOn = false;
      } else {
        try {
          adoptCam(await openCamera());
          camOn = true;
        } catch (err) {
          toast(err?.name === 'NotReadableError' ? t('camBusy') : t('camFailed'), { error: true });
        }
      }
      replace('video', camOn ? camTrack : null);
      renderMedia();
      sendMedia();
    });
  }

  function setMicOn(on) {
    return serial(async () => {
      if (!started || on === micOn) return;
      if (!on) {
        micTrack?.stop();
        adoptMic(null);
        micOn = false;
      } else {
        try {
          adoptMic(await openMic());
          micOn = true;
        } catch {
          toast(t('micFailed'), { error: true });
        }
      }
      replace('audio', micOn ? micTrack : null);
      renderMedia();
      sendMedia();
    });
  }

  function reopenMic() {
    return serial(async () => {
      if (!started || !micOn) return;
      micTrack?.stop();
      try {
        adoptMic(await openMic());
      } catch {
        adoptMic(null);
        micOn = false;
        toast(t('micFailed'), { error: true });
      }
      replace('audio', micOn ? micTrack : null);
      renderMedia();
      sendMedia();
    });
  }

  function setMode(mode, { fromHost = false } = {}) {
    if (mode !== 'nr' && mode !== 'normal') return;
    if (media.micMode === mode) return;
    media.micMode = mode;
    renderMedia();
    if (!fromHost) {
      send({ t: 'pref', micMode: mode });
      toast(mode === 'nr' ? t('modeNrOn') : t('modeNormalOn'));
    }
    // Las opciones de procesamiento se aplican al abrir el micrófono: se abre de nuevo.
    return reopenMic();
  }

  function setQuality(patch, { fromHost = false } = {}) {
    const next = { ...media, ...patch };
    if (next.quality === media.quality && next.fps === media.fps) return;
    media.quality = next.quality;
    media.fps = next.fps;
    renderSettings();
    if (!fromHost) send({ t: 'pref', quality: media.quality, fps: media.fps });
    return serial(async () => {
      if (!camTrack) return;
      try {
        await camTrack.applyConstraints(videoConstraints());
      } catch {
        camTrack.stop();
        try { adoptCam(await openCamera()); } catch { adoptCam(null); camOn = false; }
        replace('video', camOn ? camTrack : null);
      }
      applyBitrate();
      renderMedia();
      sendMedia();
    });
  }

  async function setTorch(on) {
    if (!camTrack) return;
    try {
      await camTrack.applyConstraints({ advanced: [{ torch: on }] });
      torchOn = on;
    } catch {
      torchOn = false;
    }
    renderMedia();
    sendMedia();
  }

  // ---------------------------------------------------------------- medidor del micrófono

  let meterNode = null;
  let meterRaf = 0;
  const bars = $$('#meter i');

  function meterSource(track) {
    cancelAnimationFrame(meterRaf);
    try { meterNode?.source.disconnect(); } catch {}
    meterNode = null;
    for (const b of bars) b.className = '';
    if (!track || !ctx) return;
    try {
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      meterNode = { source, analyser, data: new Float32Array(analyser.fftSize) };
    } catch {
      return;
    }
    let level = 0;
    const loop = () => {
      if (!meterNode) return;
      meterNode.analyser.getFloatTimeDomainData(meterNode.data);
      let sum = 0;
      for (const v of meterNode.data) sum += v * v;
      const rms = Math.sqrt(sum / meterNode.data.length);
      const db = 20 * Math.log10(rms || 1e-6);
      const target = Math.min(1, Math.max(0, (db + 60) / 50));
      level = target > level ? target : level * 0.86 + target * 0.14;
      const lit = Math.round(level * bars.length);
      bars.forEach((b, i) => { b.className = i < lit ? (i >= bars.length - 1 ? 'lit hot' : 'lit') : ''; });
      meterRaf = requestAnimationFrame(loop);
    };
    loop();
  }

  // ---------------------------------------------------------------- llamada con la computadora

  function senders() {
    const pc = call?.peerConnection;
    if (!pc) return {};
    const out = {};
    for (const s of pc.getSenders()) {
      const kind = s.track?.kind || pc.getTransceivers().find((tr) => tr.sender === s)?.receiver.track?.kind;
      if (kind) out[kind] = s;
    }
    return out;
  }

  function replace(kind, track) {
    const sender = senders()[kind];
    if (sender) sender.replaceTrack(track).catch(() => {});
  }

  function applyBitrate() {
    const sender = senders().video;
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    params.encodings[0].maxBitrate = BITRATE[media.quality] || BITRATE[720];
    params.encodings[0].maxFramerate = media.fps || 30;
    sender.setParameters(params).catch(() => {});
  }

  function callHost() {
    if (!started || demo || !peer || peer.destroyed || !peer.open || !session || connState !== 'connected') return;
    try { call?.close(); } catch {}
    const f = getFillers();
    const tracks = [camTrack || f.video, micTrack || f.audio].filter(Boolean);
    if (!tracks.length) return;
    const c = peer.call(session.id, new MediaStream(tracks), { metadata: { kind: 'cam' } });
    if (!c) return;
    call = c;
    // Las pistas de relleno no se envían: si la cámara o el micrófono están apagados no viaja nada.
    if (!camTrack) replace('video', null);
    if (!micTrack) replace('audio', null);
    const pc = c.peerConnection;
    pc?.addEventListener('connectionstatechange', () => {
      if (call === c && pc.connectionState === 'connected') applyBitrate();
    });
    c.on('close', () => {
      if (call !== c) return;
      call = null;
      if (started && conn?.open && connState === 'connected') setTimeout(() => { if (!call) callHost(); }, 1500);
    });
    c.on('error', () => {});
  }

  function sendMedia() {
    const s = camTrack?.getSettings?.() || {};
    const caps = camTrack?.getCapabilities?.() || {};
    let w = s.width || 0;
    let h = s.height || 0;
    const msg = {
      t: 'media',
      quality: media.quality,
      cam: { id: prefs.camId || '', label: camLabel(camTrack), facing: s.facingMode || prefs.facing || '', on: !!camTrack, w, h, fps: Math.round(s.frameRate || 0), torch: caps.torch ? torchOn : null },
      mic: { id: micTrack?.getSettings?.().deviceId || '', label: micTrack?.label?.slice(0, 40) || '', on: !!micTrack, mode: media.micMode },
      cams: cams.map(({ id, label, facing }) => ({ id, label, facing })),
      mics: mics.map(({ id, label }) => ({ id, label })),
    };
    send(msg);
    const res = $('#res-chip');
    res.hidden = !camTrack || !w;
    if (w && h) res.textContent = `${Math.max(w, h)}×${Math.min(w, h)} · ${Math.round(s.frameRate || media.fps)}`;
  }

  // ---------------------------------------------------------------- foto

  async function takePhoto() {
    if (!camTrack || !preview.videoWidth) {
      toast(t('noCamera'), { error: true });
      return;
    }
    const w = preview.videoWidth;
    const h = preview.videoHeight;
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    canvas.getContext('2d').drawImage(preview, 0, 0, w, h);
    const flash = $('#flash');
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');
    buzz([12, 40, 12]);
    const mime = media.photoFormat === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((r) => canvas.toBlob(r, mime, 0.92));
    if (!blob || demo) return;
    const data = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.readAsDataURL(blob);
    });
    const id = Date.now() % 1e9;
    const n = Math.max(1, Math.ceil(data.length / CHUNK));
    for (let i = 0; i < n; i++) {
      const part = { t: 'file', id, i, n, d: data.slice(i * CHUNK, (i + 1) * CHUNK) };
      if (i === 0) Object.assign(part, { kind: 'photo', mime, w, h });
      if (!send(part)) return;
    }
  }

  // ================================================================ vista

  function renderCams() {
    const box = $('#cams');
    const current = (!demo && camTrack?.getSettings?.().deviceId) || prefs.camId;
    box.replaceChildren(...(cams.length > 1 ? cams : []).map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(camOn && c.id === current));
      b.textContent = c.label;
      b.addEventListener('click', () => {
        buzz();
        if (c.id === current && camOn) return;
        setCamera(c.id);
      });
      return b;
    }));
  }

  function renderMics() {
    const field = $('#mic-field');
    field.hidden = mics.length < 2;
    const sel = $('#mic-select');
    const current = micTrack?.getSettings?.().deviceId || prefs.micId;
    sel.replaceChildren(...mics.map((m) => new Option(m.label, m.id, false, m.id === current)));
  }

  function renderMedia() {
    $('#mic-btn').setAttribute('aria-pressed', String(micOn && !!micTrack));
    $('#cam-btn').setAttribute('aria-pressed', String(camOn && !!camTrack));
    $('#cam-off').hidden = !started || !!camTrack;
    $('#flip-btn').disabled = !started;
    $('#photo-btn').disabled = !started || !camTrack;
    for (const b of $$('#mode button')) b.setAttribute('aria-checked', String(b.dataset.mode === media.micMode));
    $('#mode').classList.toggle('disabled', !micTrack);
    const facing = camTrack?.getSettings?.().facingMode || cams.find((c) => c.id === prefs.camId)?.facing || prefs.facing;
    preview.classList.toggle('mirror', prefs.mirror && facing !== 'environment');
    const caps = camTrack?.getCapabilities?.() || {};
    $('#torch').hidden = !caps.torch;
    $('#torch').classList.toggle('on', torchOn);
    renderCams();
    renderStatus();
  }

  let recTimer = 0;
  function renderStatus() {
    const chip = $('#live-chip');
    const uses = status.uses || [];
    let text;
    if (!started) text = t('standby');
    else if (status.live && uses.length) text = `${t('inUse')} · ${uses.join(', ')}`;
    else if (status.live) text = t('onAir');
    else text = t('standby');
    chip.classList.toggle('on', started && status.live);
    $('#live-text').textContent = text;
    $('#use-btn').hidden = !started || status.live || connState !== 'connected';

    const recording = !!status.rec;
    $('#rec-btn').setAttribute('aria-pressed', String(recording));
    $('#rec-btn .ctl-label').textContent = recording ? t('stopRec') : t('record');
    $('#rec-btn').disabled = !started;
    $('#rec-pill').hidden = !recording;
    clearInterval(recTimer);
    if (recording) {
      const tick = () => { $('#rec-time').textContent = fmtClock(Date.now() - clockOffset - status.rec); };
      tick();
      recTimer = setInterval(tick, 500);
    }
  }

  // ================================================================ conexión (PeerJS)

  const GATE = {
    idle: ['gateIdleTitle', 'gateIdleBody', false, false],
    connecting: ['gateConnectingTitle', 'gateConnectingBody', true, false],
    waiting: ['gateWaitingTitle', 'gateWaitingBody', true, false],
    offline: ['gateOfflineTitle', 'gateOfflineBody', true, true],
    denied: ['gateDeniedTitle', 'gateDeniedBody', false, false],
    ended: ['gateEndedTitle', 'gateEndedBody', true, false],
    kicked: ['gateKickedTitle', 'gateKickedBody', false, true],
    unsupported: ['gateUnsupportedTitle', 'gateUnsupportedBody', false, false],
  };
  const BLOCKING = new Set(['idle', 'denied', 'kicked', 'unsupported', 'ended']);

  function setConn(state) {
    connState = state;
    const shown = state === 'connecting' && everConnected ? 'reconnecting' : state;
    app.dataset.conn = shown;
    const labels = { connected: 'connected', connecting: 'connecting', reconnecting: 'reconnecting', waiting: 'reconnecting', offline: 'offline' };
    $('#status-text').textContent = t(labels[shown] || 'offline');

    const ready = state === 'connected' || (everConnected && !BLOCKING.has(state));
    app.classList.toggle('ready', ready);
    const [title, body, spinner, retry] = GATE[state] || GATE.connecting;
    $('#gate-title').textContent = t(title);
    $('#gate-body').textContent = t(body);
    $('#gate-spinner').hidden = !spinner;
    $('#gate-retry').hidden = !retry;
    // Sin sesión no tiene sentido mantener la cámara encendida.
    if (BLOCKING.has(state) && state !== 'ended') stopMedia();
    renderStatus();
  }

  function stopMedia() {
    if (!started) return;
    started = false;
    try { call?.close(); } catch {}
    call = null;
    camTrack?.stop();
    micTrack?.stop();
    adoptCam(null);
    adoptMic(null);
    releaseAwake();
    renderMedia();
  }

  function scheduleRetry(fn, delay = retryDelay) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(fn, delay);
    retryDelay = Math.min(retryDelay * 1.5, 6000);
  }

  // Credenciales de retransmisión: si el Worker no responde, se usa la conexión directa.
  let icePromise = null;
  function getIce() {
    if (!icePromise) {
      icePromise = (async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        try {
          const res = await fetch(ICE_ENDPOINT, { signal: ctrl.signal, cache: 'no-store' });
          if (!res.ok) throw new Error(String(res.status));
          const data = await res.json();
          if (!Array.isArray(data.iceServers) || !data.iceServers.length) throw new Error('sin servidores');
          setTimeout(() => { icePromise = null; }, ICE_REFRESH_MS);
          return { iceServers: data.iceServers };
        } catch {
          icePromise = null;
          return FALLBACK_ICE;
        } finally {
          clearTimeout(timer);
        }
      })();
    }
    return icePromise;
  }

  let startingPeer = false;
  async function startPeer() {
    if (!session) { setConn('idle'); return; }
    if (typeof Peer === 'undefined' || !window.RTCPeerConnection) { setConn('unsupported'); return; }
    if (peer && !peer.destroyed) {
      if (peer.disconnected) peer.reconnect();
      else if (peer.open) openConn();
      return;
    }
    if (startingPeer) return;
    if (!everConnected) setConn('connecting');
    startingPeer = true;
    const config = await getIce();
    startingPeer = false;
    if (peer && !peer.destroyed) return;
    peer = new Peer({ debug: 0, config });
    const current = peer;
    current.on('open', () => { if (current === peer) openConn(); });
    // La computadora nunca llama al celular: solo recibe.
    current.on('call', (c) => { try { c.close(); } catch {} });
    current.on('disconnected', () => {
      if (current !== peer || current.destroyed) return;
      scheduleRetry(() => { if (!current.destroyed && current.disconnected) current.reconnect(); });
    });
    current.on('error', (err) => {
      if (current !== peer) return;
      switch (err.type) {
        case 'peer-unavailable':
          if (!BLOCKING.has(connState)) setConn('waiting');
          scheduleRetry(openConn);
          break;
        case 'browser-incompatible':
          setConn('unsupported');
          break;
        case 'network':
        case 'server-error':
        case 'socket-error':
        case 'socket-closed':
          if (!conn?.open) setConn('offline');
          scheduleRetry(restartPeer);
          break;
        default:
          scheduleRetry(restartPeer);
      }
    });
  }

  function restartPeer() {
    try { peer?.destroy(); } catch {}
    peer = null;
    call = null;
    startPeer();
  }

  function openConn() {
    clearTimeout(retryTimer);
    if (!session || !peer || peer.destroyed || peer.disconnected || !peer.open) return;
    if (conn) {
      try { conn.removeAllListeners(); conn.close(); } catch {}
    }
    const c = peer.connect(session.id, { serialization: 'json', reliable: true });
    conn = c;
    if (!BLOCKING.has(connState)) setConn(everConnected ? 'reconnecting' : 'connecting');
    const timeout = setTimeout(() => {
      if (c === conn && !c.open) {
        try { c.close(); } catch {}
        if (!BLOCKING.has(connState)) setConn('waiting');
        scheduleRetry(openConn);
      }
    }, 12000);
    c.on('open', () => {
      clearTimeout(timeout);
      c.send({ t: 'hello', k: session.k, name: deviceName(), v: 1 });
    });
    c.on('data', (msg) => { if (c === conn) onData(msg); });
    c.on('close', () => {
      clearTimeout(timeout);
      if (c !== conn) return;
      conn = null;
      stopPing();
      if (['denied', 'kicked', 'unsupported', 'idle'].includes(connState)) return;
      if (connState !== 'ended') setConn('waiting');
      scheduleRetry(openConn, connState === 'ended' ? 4000 : retryDelay);
    });
    c.on('error', () => {});
  }

  function onData(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome':
        everConnected = true;
        retryDelay = 1200;
        lastPong = Date.now();
        if (typeof msg.now === 'number') clockOffset = Date.now() - msg.now;
        applyHostPrefs(msg.prefs, true);
        setConn('connected');
        startPing();
        if (started) {
          callHost();
          sendMedia();
          keepAwake();
        } else {
          $('#start').hidden = false;
        }
        buzz(20);
        break;
      case 'prefs':
        applyHostPrefs(msg.prefs, false);
        break;
      case 'status':
        if (typeof msg.now === 'number') clockOffset = Date.now() - msg.now;
        status = { live: msg.live === true, uses: Array.isArray(msg.uses) ? msg.uses.filter((u) => typeof u === 'string').map((u) => u.slice(0, 60)).slice(0, 4) : [], rec: Number(msg.rec) || 0 };
        renderStatus();
        break;
      case 'set':
        onRemoteSet(msg);
        break;
      case 'snap':
        takePhoto();
        break;
      case 'done':
        onDone(msg);
        break;
      case 'pong':
        lastPong = Date.now();
        latency = Math.max(1, Math.round((Date.now() - msg.ts) / 2));
        $('#latency').textContent = `${latency} ms`;
        break;
      case 'denied':
        session = null;
        store.set('session', null);
        setConn('denied');
        closeConn();
        break;
      case 'bye':
        if (msg.reason === 'revoked') {
          session = null;
          store.set('session', null);
          setConn('denied');
          closeConn();
        } else if (msg.reason === 'kicked') {
          setConn('kicked');
          closeConn();
        } else {
          setConn('ended');
          stopMedia();
        }
        break;
    }
  }

  function applyHostPrefs(p, initial) {
    if (!p || typeof p !== 'object') return;
    if (p.photoFormat === 'png' || p.photoFormat === 'jpeg') media.photoFormat = p.photoFormat;
    const quality = ['480', '720', '1080'].includes(p.quality) ? p.quality : media.quality;
    const fps = [24, 30, 60].includes(p.fps) ? p.fps : media.fps;
    if (initial && !started) {
      media.quality = quality;
      media.fps = fps;
      if (p.micMode === 'nr' || p.micMode === 'normal') media.micMode = p.micMode;
      renderSettings();
      renderMedia();
      return;
    }
    setQuality({ quality, fps }, { fromHost: true });
    if (p.micMode === 'nr' || p.micMode === 'normal') setMode(p.micMode, { fromHost: true });
  }

  function onRemoteSet(m) {
    if (!started) return;
    if (typeof m.cam === 'string' && cams.some((c) => c.id === m.cam)) setCamera(m.cam);
    if (m.flip === true) flip();
    if (typeof m.camOn === 'boolean') setCamOn(m.camOn);
    if (typeof m.micOn === 'boolean') setMicOn(m.micOn);
    if (m.mode === 'nr' || m.mode === 'normal') {
      if (media.micMode !== m.mode) toast(m.mode === 'nr' ? t('modeNrOn') : t('modeNormalOn'));
      setMode(m.mode, { fromHost: true });
    }
    if (typeof m.torch === 'boolean') setTorch(m.torch);
  }

  function onDone(m) {
    switch (m.what) {
      case 'photo':
        toast(m.ok ? t('photoSaved') : t('photoFailed'), { error: !m.ok });
        break;
      case 'rec':
        if (m.ok) toast(t('recStarted'));
        else toast(t('recFailed'), { error: true });
        break;
      case 'recStop':
        toast(t('recSaved'));
        break;
    }
  }

  function closeConn() {
    clearTimeout(retryTimer);
    stopPing();
    const c = conn;
    conn = null;
    try { c?.removeAllListeners(); c?.close(); } catch {}
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
      if (!conn?.open) return;
      if (Date.now() - lastPong > 15000) {
        // Conexión colgada: forzar reconexión.
        const c = conn;
        conn = null;
        try { c.close(); } catch {}
        setConn('waiting');
        restartPeer();
        return;
      }
      send({ t: 'ping', ts: Date.now() });
    }, 4000);
  }

  function stopPing() {
    clearInterval(pingTimer);
  }

  let lastOfflineToast = 0;
  const SILENT = new Set(['ping', 'media', 'pref', 'file']);
  function send(msg) {
    if (demo) return true;
    if (conn?.open && connState === 'connected') {
      try { conn.send(msg); return true; } catch {}
    }
    if (!SILENT.has(msg.t) && Date.now() - lastOfflineToast > 3000) {
      lastOfflineToast = Date.now();
      toast(t('notConnected'), { error: true });
    }
    return false;
  }

  // ================================================================ pantalla encendida

  let wakeLock = null;

  async function keepAwake() {
    if (!prefs.wake || !('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch {}
  }

  function releaseAwake() {
    try { wakeLock?.release(); } catch {}
    wakeLock = null;
  }

  // ================================================================ ajustes

  const sheet = $('#settings');

  function renderSettings() {
    for (const b of $$('#quality button')) b.setAttribute('aria-checked', String(b.dataset.v === media.quality));
    for (const b of $$('#fps button')) b.setAttribute('aria-checked', String(Number(b.dataset.v) === media.fps));
    $('#mirror').checked = prefs.mirror;
    $('#haptics').checked = prefs.haptics;
    $('#wake').checked = prefs.wake;
    $('#latency').textContent = latency ? `${latency} ms` : '—';
  }

  $('#open-settings').addEventListener('click', () => {
    renderSettings();
    sheet.showModal();
  });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
  for (const b of $$('#quality button')) b.addEventListener('click', () => { buzz(); setQuality({ quality: b.dataset.v }); });
  for (const b of $$('#fps button')) b.addEventListener('click', () => { buzz(); setQuality({ fps: Number(b.dataset.v) }); });
  $('#mirror').addEventListener('change', (e) => { prefs.mirror = e.target.checked; savePrefs(); renderMedia(); });
  $('#haptics').addEventListener('change', (e) => { prefs.haptics = e.target.checked; savePrefs(); buzz(); });
  $('#wake').addEventListener('change', (e) => {
    prefs.wake = e.target.checked;
    savePrefs();
    if (prefs.wake) keepAwake(); else releaseAwake();
  });
  $('#mic-select').addEventListener('change', (e) => {
    prefs.micId = e.target.value;
    savePrefs();
    reopenMic();
  });
  $('#forget').addEventListener('click', () => {
    store.set('session', null);
    session = null;
    sheet.close();
    closeConn();
    try { peer?.destroy(); } catch {}
    peer = null;
    setConn('idle');
  });

  // ================================================================ controles

  $('#start-btn').addEventListener('click', () => { buzz(); startMedia(); });
  $('#gate-retry').addEventListener('click', () => {
    if (connState === 'kicked') setConn('connecting');
    restartPeer();
  });
  $('#status-btn').addEventListener('click', () => { if (connState !== 'connected') restartPeer(); });
  $('#mic-btn').addEventListener('click', () => { buzz(); setMicOn(!micOn); });
  $('#cam-btn').addEventListener('click', () => { buzz(); setCamOn(!camOn); });
  $('#flip-btn').addEventListener('click', () => { buzz(); flip(); });
  $('#photo-btn').addEventListener('click', () => takePhoto());
  $('#rec-btn').addEventListener('click', () => { buzz(16); send({ t: 'rec', on: !status.rec }); });
  $('#use-btn').addEventListener('click', () => { buzz(); send({ t: 'use' }); });
  $('#torch').addEventListener('click', () => { buzz(); setTorch(!torchOn); });
  for (const b of $$('#mode button')) b.addEventListener('click', () => { buzz(); setMode(b.dataset.mode); });

  navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (started) refreshDevices().then(sendMedia); });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (started) {
      keepAwake();
      // iOS apaga la cámara al pasar a segundo plano: se vuelve a abrir.
      if (camOn && (!camTrack || camTrack.readyState === 'ended')) { camOn = false; setCamOn(true); }
      if (micOn && (!micTrack || micTrack.readyState === 'ended')) { micOn = false; setMicOn(true); }
    }
    if (!demo && session && (!conn || !conn.open)) startPeer();
  });
  window.addEventListener('online', () => { if (!demo && session) restartPeer(); });

  // Código nuevo escaneado con esta misma pestaña abierta: solo cambia el fragmento #.
  window.addEventListener('hashchange', () => {
    const next = new URLSearchParams(location.hash.slice(1));
    if (!next.get('id') || !next.get('k') || demo) return;
    session = { id: next.get('id'), k: next.get('k') };
    store.set('session', session);
    history.replaceState(null, '', location.pathname + location.search);
    everConnected = false;
    closeConn();
    restartPeer();
  });

  // ================================================================ demostración (capturas de la tienda)

  async function startDemo() {
    app.classList.add('instant');
    everConnected = true;
    latency = 9;
    setConn('connected');
    status = { live: true, uses: (query.get('uses') || 'Visor de Capturazo').split(',').filter(Boolean), rec: query.has('rec') ? Date.now() - 83000 : 0 };
    if (query.get('mode') === 'normal') media.micMode = 'normal';
    if (query.has('start')) {
      $('#start').hidden = false;
      renderMedia();
      return;
    }
    started = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(camSelector()), audio: audioConstraints() });
      audioCtx();
      adoptCam(stream.getVideoTracks()[0] || null);
      adoptMic(stream.getAudioTracks()[0] || null);
    } catch {}
    await refreshDevices();
    if (cams.length < 2) {
      cams = [
        { id: 'demo-front', label: t('front'), facing: 'user' },
        { id: 'demo-back', label: t('back'), facing: 'environment' },
        { id: 'demo-wide', label: t('ultraWide'), facing: 'environment' },
        { id: 'demo-tele', label: t('tele'), facing: 'environment' },
      ];
      prefs.camId = query.get('cam') || 'demo-back';
    }
    camOn = !query.has('camoff');
    if (!camOn) { camTrack?.stop(); adoptCam(null); }
    if (query.get('cam')) prefs.camId = query.get('cam');
    else if (cams.some((c) => c.id === 'demo-back')) prefs.camId = 'demo-back';
    micOn = !!micTrack;
    renderMedia();
    sendMedia();
    if (query.get('sheet') === 'settings') { renderSettings(); sheet.showModal(); }
  }

  // ================================================================ inicio

  renderSettings();
  renderMedia();
  if (demo) {
    startDemo();
  } else if (session) {
    startPeer();
  } else {
    setConn('idle');
  }
})();
