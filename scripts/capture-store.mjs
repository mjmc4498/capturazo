// Capturas reales de Capturazo para la ficha de la tienda y la presentación.
//
//   npm run serve            (otra terminal)
//   npm run store:capture    → design/store/captures/*.png y presentacion/img/*.png
//
// Usa la extensión real, el celular real (página remote/ con la cámara y el micrófono
// simulados de scripts/demo-media.py) y una videollamada de prueba servida como
// https://reunion.example.com (dominio reservado para ejemplos).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://localhost:8767';
const OUT = path.join(ROOT, 'test', 'out');
const MEDIA = path.join(OUT, 'media');
const SHOTS = path.join(ROOT, 'design', 'store', 'captures');
const PRES = path.join(ROOT, 'presentacion', 'img');
const CALL_URL = 'https://reunion.example.com/sala';
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(PRES, { recursive: true });
if (!fs.existsSync(path.join(MEDIA, 'camara.mjpeg'))) execFileSync('python3', [path.join(ROOT, 'scripts', 'demo-media.py')], { stdio: 'inherit' });

// Fuera del proyecto: un Escritorio sincronizado con iCloud deja copias de conflicto.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'capturazo-capturas-'));
const EXT = path.join(TMP, 'extension');
fs.rmSync(EXT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'extension'), EXT, { recursive: true });
const manifestPath = path.join(EXT, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.host_permissions = [`${BASE}/*`, 'https://reunion.example.com/*'];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const PROFILE = path.join(TMP, 'perfil');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 20000, interval = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(interval);
  }
  return null;
}

async function save(page, name, opts = {}) {
  const file = path.join(SHOTS, `${name}.png`);
  // Las pestañas en segundo plano no dibujan: se trae al frente antes de capturar.
  await page.bringToFront();
  await sleep(250);
  if (opts.element) await (await page.$(opts.element)).screenshot({ path: file });
  else await page.screenshot({ path: file, ...opts });
  fs.copyFileSync(file, path.join(PRES, `${name}.png`));
  console.log('  ', path.relative(ROOT, file));
}

const browser = await puppeteer.launch({
  headless: true,
  pipe: true,
  userDataDir: PROFILE,
  enableExtensions: [EXT],
  args: [
    '--window-size=1400,900',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${path.join(MEDIA, 'camara.mjpeg')}`,
    `--use-file-for-fake-audio-capture=${path.join(MEDIA, 'microfono.wav')}`,
    '--disable-features=AudioServiceSandbox',
    '--hide-scrollbars',
  ],
  defaultViewport: null,
});

// El celular de las capturas: un iPhone con cámaras frontal, trasera, ultra gran angular y teleobjetivo.
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
function phoneDevices() {
  const native = MediaDevices.prototype.enumerateDevices;
  MediaDevices.prototype.enumerateDevices = async function enumerateDevices() {
    const list = await native.call(this);
    const out = [];
    for (const d of list) {
      if (d.kind === 'videoinput') out.push({ deviceId: d.deviceId, kind: 'videoinput', label: 'Cámara frontal', groupId: d.groupId });
      else if (d.kind === 'audioinput' && d.deviceId === 'default') out.push({ deviceId: d.deviceId, kind: 'audioinput', label: 'Micrófono del iPhone', groupId: d.groupId });
    }
    out.push(
      { deviceId: 'trasera', kind: 'videoinput', label: 'Cámara trasera', groupId: 't' },
      { deviceId: 'ultra', kind: 'videoinput', label: 'Cámara trasera con ultra gran angular', groupId: 'u' },
      { deviceId: 'tele', kind: 'videoinput', label: 'Cámara trasera con teleobjetivo', groupId: 'te' },
      { deviceId: 'airpods', kind: 'audioinput', label: 'AirPods Pro', groupId: 'a' },
    );
    return out;
  };
}

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  console.log('Capturas reales:');

  // ---------- bienvenida y ajustes
  const opts = (await waitFor(async () => (await browser.pages()).find((p) => p.url().includes('options.html')), { timeout: 6000 })) || (await browser.newPage());
  await opts.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });
  await opts.goto(`chrome-extension://${extId}/options.html#bienvenida`);
  await opts.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await opts.evaluate(async (base) => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...(settings || {}), remoteUrl: `${base}/remote/` } });
  }, BASE);
  await sleep(500);
  await save(opts, 'options');
  await opts.evaluate(() => document.querySelector('#sitios').scrollIntoView());
  await sleep(200);
  await save(opts, 'options-ajustes');
  const sw = (msg) => opts.evaluate((m) => chrome.runtime.sendMessage({ to: 'sw', ...m }), msg);
  const state = async () => (await opts.evaluate(() => chrome.storage.session.get('state'))).state;

  // ---------- panel con el QR
  await sw({ type: 'session:start' });
  await waitFor(async () => (await state())?.status === 'ready', { timeout: 25000 });
  const popup = await browser.newPage();
  await popup.setViewport({ width: 360, height: 560, deviceScaleFactor: 2 });
  await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForSelector('#qr svg');
  await sleep(600);
  await save(popup, 'popup-qr', { element: 'body' });

  // ---------- celular conectado
  const { identity } = await opts.evaluate(() => chrome.storage.local.get('identity'));
  const phoneCtx = await browser.createBrowserContext();
  await phoneCtx.overridePermissions(BASE, ['camera', 'microphone']);
  const phone = await phoneCtx.newPage();
  await phone.setUserAgent(IPHONE_UA);
  await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await phone.evaluateOnNewDocument(phoneDevices);
  await phone.goto(`${BASE}/remote/#id=${identity.peerId}&k=${identity.token}`);
  await waitFor(() => phone.$eval('#start', (e) => !e.hidden), { timeout: 25000 });
  await sleep(300);
  await save(phone, 'phone-inicio');
  await phone.tap('#start-btn');
  await waitFor(async () => (await state())?.devices?.[0]?.streaming, { timeout: 20000 });

  // ---------- videollamada (dominio de ejemplo servido por Puppeteer)
  const html = fs.readFileSync(path.join(ROOT, 'test', 'videollamada.html'), 'utf8');
  const call = await browser.newPage();
  await call.setRequestInterception(true);
  call.on('request', (req) => {
    if (req.url().startsWith('https://reunion.example.com/')) req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    else req.continue();
  });
  await call.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
  await call.goto(CALL_URL, { waitUntil: 'networkidle0' });
  await call.evaluate(async () => {
    await window.__test.listDevices();
    document.querySelector('#cam').value = 'capturazo-camara';
    document.querySelector('#mic').value = 'capturazo-microfono';
    await window.__test.start('capturazo-camara', 'capturazo-microfono');
  });
  await waitFor(async () => (await call.evaluate(() => window.__test.frameStats()))?.w >= 1280, { timeout: 20000 });
  await waitFor(async () => (await call.evaluate(() => window.__test.audioLevel())) > 0.05, { timeout: 8000 });
  await sleep(400);
  await save(call, 'videollamada');

  // ---------- celular en uso, con sus cámaras
  await waitFor(() => phone.$eval('#live-text', (e) => e.textContent.includes('reunion.example.com')), { timeout: 8000 });
  await sleep(800);
  await save(phone, 'phone-en-uso');
  await phone.tap('#mode [data-mode="normal"]');
  await sleep(2800); // que se vaya el aviso
  await save(phone, 'phone-normal');
  await phone.tap('#mode [data-mode="nr"]');
  await sleep(800);

  // ---------- panel con la señal del celular
  await popup.setViewport({ width: 360, height: 760, deviceScaleFactor: 2 });
  await popup.reload();
  await waitFor(() => popup.evaluate(() => !document.querySelector('#live').hidden && document.querySelector('#preview').videoWidth > 0), { timeout: 15000 });
  await sleep(1500);
  await save(popup, 'popup-vivo', { element: 'body' });

  // ---------- visor
  const visor = await browser.newPage();
  await visor.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
  await visor.goto(`chrome-extension://${extId}/visor.html`);
  await waitFor(() => visor.evaluate(() => document.querySelector('#idle').hidden && document.querySelector('#video').videoWidth >= 1280), { timeout: 20000 });
  await visor.mouse.move(640, 400);
  await visor.mouse.move(650, 420);
  await sleep(500);
  await save(visor, 'visor');

  // ---------- grabación
  await phone.tap('#rec-btn');
  await waitFor(async () => (await state())?.rec, { timeout: 8000 });
  await sleep(4200);
  await save(phone, 'phone-grabando');
  await visor.mouse.move(600, 380);
  await sleep(300);
  await save(visor, 'visor-grabando');
  await popup.reload();
  await waitFor(() => popup.evaluate(() => document.querySelector('#preview').videoWidth > 0), { timeout: 15000 });
  await sleep(1200);
  await save(popup, 'popup-grabando', { element: 'body' });
  await sw({ type: 'rec:stop' });
  await sleep(1500);

  // ---------- ajustes del celular
  await phone.tap('#open-settings');
  await sleep(700);
  await save(phone, 'phone-ajustes');
} finally {
  // A veces Chrome no termina de cerrarse (con la grabación recién guardada): se espera
  // un poco y se cierra a la fuerza solo este navegador.
  await Promise.race([browser.close(), sleep(10000)]);
  browser.process()?.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
}
