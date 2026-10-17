// Mide el retardo real de punta a punta (de la cámara del celular a la pantalla).
//
//   npm run serve          (otra terminal)
//   npm run test:latencia
//
// El «celular» de la prueba usa como cámara un lienzo que dibuja la hora exacta (en
// milisegundos) como 40 casillas blancas y negras. La videollamada de prueba y el visor
// leen esa hora en cada cuadro que reciben: la diferencia con la hora actual es el
// retardo completo — codificación en el celular, red, la extensión, el reparto local y
// la decodificación. Todo corre en la misma computadora, así que el reloj es el mismo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://localhost:8767';
const SECONDS = Number(process.env.SEGUNDOS || 12);
const FPS = Number(process.env.FPS || 30);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'capturazo-latencia-'));
const EXT = path.join(TMP, 'extension');
fs.cpSync(path.join(ROOT, 'extension'), EXT, { recursive: true });
const manifestPath = path.join(EXT, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.host_permissions = [`${BASE}/*`];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 20000, interval = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(interval);
  }
  return null;
}

// Cámara del «celular»: la hora en 40 casillas de 128×180 px (resisten la compresión).
function clockCamera(fps) {
  // Se guardan las conexiones del celular para ver qué se negoció.
  const NativePC = window.RTCPeerConnection;
  window.__pcs = [];
  window.RTCPeerConnection = function RTCPeerConnection(...args) {
    const pc = new NativePC(...args);
    window.__pcs.push(pc);
    return pc;
  };
  window.RTCPeerConnection.prototype = NativePC.prototype;
  const native = MediaDevices.prototype.getUserMedia;
  MediaDevices.prototype.getUserMedia = async function getUserMedia(c = {}) {
    const tracks = c.audio ? (await native.call(this, { audio: c.audio })).getAudioTracks() : [];
    if (c.video) {
      const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
      const g = canvas.getContext('2d');
      const draw = () => {
        const t = Date.now() % 2 ** 40;
        for (let i = 0; i < 40; i++) {
          g.fillStyle = Math.floor(t / 2 ** i) % 2 ? '#fff' : '#000';
          g.fillRect((i % 10) * 128, Math.floor(i / 10) * 180, 128, 180);
        }
      };
      draw();
      setInterval(draw, 2);
      tracks.push(canvas.captureStream(fps).getVideoTracks()[0]);
    }
    return new MediaStream(tracks);
  };
}

// Lector: lee la hora de cada cuadro apenas llega a la pista de video del sitio o del
// visor (MediaStreamTrackProcessor). Así no se mide cómo compone la pantalla el Chrome
// sin interfaz de la prueba, que no se parece a una pantalla real.
function startReader(selector) {
  const video = document.querySelector(selector);
  const track = video.srcObject.getVideoTracks()[0].clone();
  const canvas = new OffscreenCanvas(160, 90);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const reader = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 }).readable.getReader();
  window.__lat = [];
  (async () => {
    for (;;) {
      const { value: frame, done } = await reader.read();
      if (done) break;
      const now = Date.now() % 2 ** 40;
      g.drawImage(frame, 0, 0, 160, 90);
      frame.close();
      const d = g.getImageData(0, 0, 160, 90).data;
      let t = 0;
      for (let i = 0; i < 40; i++) {
        const x = (i % 10) * 16 + 8;
        const y = Math.floor(Math.floor(i / 10) * 22.5 + 11);
        const p = (y * 160 + x) * 4;
        if (d[p] + d[p + 1] + d[p + 2] > 384) t += 2 ** i;
      }
      const ms = now - t;
      if (ms >= 0 && ms < 5000) window.__lat.push(ms);
    }
  })();
}

function summary(list) {
  const s = [...list].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { cuadros: s.length, mediana: q(0.5), p90: q(0.9), min: s[0] };
}

const browser = await puppeteer.launch({
  headless: true,
  pipe: true,
  userDataDir: path.join(TMP, 'perfil'),
  enableExtensions: [EXT],
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    // Las pestañas de la prueba no deben frenarse por estar en segundo plano.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  const ctl = await browser.newPage();
  await ctl.goto(`chrome-extension://${extId}/options.html`);
  await ctl.evaluate(async (base) => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...(settings || {}), remoteUrl: `${base}/remote/` } });
  }, BASE);
  const sw = (msg) => ctl.evaluate((m) => chrome.runtime.sendMessage({ to: 'sw', ...m }), msg);
  const state = async () => (await ctl.evaluate(() => chrome.storage.session.get('state'))).state;
  await sw({ type: 'session:start' });
  await waitFor(async () => (await state())?.status === 'ready', { timeout: 25000 });
  if (FPS !== 30) await ctl.evaluate(async (fps) => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...settings, fps } });
  }, FPS);

  const { identity } = await ctl.evaluate(() => chrome.storage.local.get('identity'));
  const phoneCtx = await browser.createBrowserContext();
  await phoneCtx.overridePermissions(BASE, ['camera', 'microphone']);
  const phone = await phoneCtx.newPage();
  await phone.evaluateOnNewDocument(clockCamera, FPS);
  await phone.goto(`${BASE}/remote/#id=${identity.peerId}&k=${identity.token}`);
  await waitFor(() => phone.$eval('#start', (e) => !e.hidden), { timeout: 25000 });
  await phone.click('#start-btn');
  await waitFor(async () => (await state())?.devices?.[0]?.streaming, { timeout: 20000 });

  const call = await browser.newPage();
  await call.goto(`${BASE}/test/videollamada.html`, { waitUntil: 'networkidle0' });
  await call.evaluate(() => window.__test.start('capturazo-camara', 'capturazo-microfono'));
  const visor = await browser.newPage();
  await visor.goto(`chrome-extension://${extId}/visor.html`);
  await waitFor(() => visor.evaluate(() => document.querySelector('#video').videoWidth >= 1280), { timeout: 20000 });
  await waitFor(() => call.evaluate(() => window.__test.frameStats()?.w >= 1280), { timeout: 20000 });
  await sleep(3000); // que se estabilice la calidad
  // Una pestaña en segundo plano no muestra cuadros: se mide cada una al frente.
  const measure = async (p) => {
    await p.bringToFront();
    await sleep(1000);
    await p.evaluate(startReader, '#video');
    await sleep(SECONDS * 1000);
    return summary(await p.evaluate(() => window.__lat));
  };
  const page = await measure(call);
  const view = await measure(visor);
  const res = await call.evaluate(() => window.__test.frameStats());
  const neg = await phone.evaluate(async () => {
    for (const pc of window.__pcs) {
      if (!pc.getSenders().some((s) => s.track?.kind === 'video')) continue;
      const stats = await pc.getStats();
      const codecs = {};
      stats.forEach((r) => { if (r.type === 'codec') codecs[r.id] = r.mimeType; });
      let video = '';
      stats.forEach((r) => { if (r.type === 'outbound-rtp' && r.kind === 'video') video = codecs[r.codecId] || ''; });
      const ptime = (pc.remoteDescription?.sdp.match(/a=ptime:(\d+)/) || [])[1] || '20';
      return { video, ptime };
    }
    return null;
  });
  if (neg) console.log(`  celular: video ${neg.video} · audio en paquetes de ${neg.ptime} ms`);
  console.log(`Retardo de punta a punta (${SECONDS} s, ${FPS} cuadros por segundo, ${res.w}×${res.h}):`);
  console.log(`  videollamada  mediana ${page.mediana} ms · p90 ${page.p90} ms · mínimo ${page.min} ms · ${page.cuadros} cuadros`);
  console.log(`  visor         mediana ${view.mediana} ms · p90 ${view.p90} ms · mínimo ${view.min} ms · ${view.cuadros} cuadros`);
  if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify({ page, view, fps: FPS }));
} finally {
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}
