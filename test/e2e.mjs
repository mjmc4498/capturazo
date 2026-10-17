// Prueba de punta a punta de Capturazo: extensión + celular (página real con cámara y
// micrófono simulados por Chrome) conectados por PeerJS, y una videollamada de prueba
// que usa el celular como cámara y micrófono. Requiere un servidor local en la raíz:
//   npm run serve        (otra terminal)
//   npm run test:e2e
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://localhost:8767';
const OUT = process.env.OUT || path.join(ROOT, 'test', 'out');
const DL = path.join(OUT, 'downloads');
const MEDIA = path.join(OUT, 'media');
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });
if (!fs.existsSync(path.join(MEDIA, 'camara.mjpeg'))) execFileSync('python3', [path.join(ROOT, 'scripts', 'demo-media.py')], { stdio: 'inherit' });

// Copia de la extensión con acceso a la página de prueba concedido desde el manifiesto
// (el diálogo de Chrome para permitir un sitio no se puede pulsar en modo headless).
const EXT = path.join(OUT, 'extension');
fs.rmSync(EXT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'extension'), EXT, { recursive: true });
const manifestPath = path.join(EXT, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.host_permissions = [`${BASE}/*`];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 15000, interval = 150 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(interval);
  }
  return null;
}

const downloads = () => {
  const dir = path.join(DL, 'Capturazo');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.endsWith('.crdownload')) : [];
};

// Perfil temporal con carpeta de descargas propia (chrome.downloads respeta la subcarpeta).
const PROFILE = fs.mkdtempSync(path.join(OUT, 'perfil-'));
fs.mkdirSync(path.join(PROFILE, 'Default'), { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'Default', 'Preferences'), JSON.stringify({
  download: { default_directory: DL, prompt_for_download: false, directory_upgrade: true },
  savefile: { default_directory: DL },
}));

const browser = await puppeteer.launch({
  headless: process.env.HEADFUL ? false : true,
  pipe: true,
  userDataDir: PROFILE,
  enableExtensions: [EXT],
  args: [
    '--window-size=1280,860',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${path.join(MEDIA, 'camara.mjpeg')}`,
    `--use-file-for-fake-audio-capture=${path.join(MEDIA, 'microfono.wav')}`,
    // El servicio de audio aislado no puede leer el WAV del micrófono simulado.
    '--disable-features=AudioServiceSandbox',
  ],
  defaultViewport: null,
});

// Color medio de la escena de demostración (piel, suéter, pared): claro y cálido. La
// imagen de espera de Capturazo es casi negra.
const isScene = (s) => !!s && s.r > 90 && s.r > s.b;
const isWaiting = (s) => !!s && s.r < 40 && s.g < 50;

try {
  // ---------- extensión cargada
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  check('Service worker cargado', !!extId, extId);

  const welcome = await waitFor(async () => (await browser.pages()).find((p) => p.url().includes('options.html')), { timeout: 6000 });
  check('Se abre la bienvenida al instalar', !!welcome);
  const ctl = welcome || (await browser.newPage());
  if (!welcome) await ctl.goto(`chrome-extension://${extId}/options.html#bienvenida`);
  await ctl.waitForSelector('.hero h1');
  const heroText = await ctl.$eval('.hero h1', (e) => e.textContent);
  check('La bienvenida tiene sus textos', heroText.includes('cámara y el micrófono'), heroText);

  const sw = (msg) => ctl.evaluate((m) => chrome.runtime.sendMessage({ to: 'sw', ...m }), msg);
  const state = async () => (await ctl.evaluate(() => chrome.storage.session.get('state'))).state;

  const real = await ctl.evaluate(() => chrome.runtime.getManifest());
  check('Permisos mínimos y acceso a los sitios opcional',
    real.optional_host_permissions?.includes('https://*/*') && !real.permissions.includes('tabs') && !real.permissions.includes('tabCapture'),
    real.permissions.join(', '));

  // Scripts de la cámara registrados solo para los sitios permitidos.
  const scripts = await waitFor(async () => {
    const list = await ctl.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    return list.length === 2 ? list : null;
  }, { timeout: 5000 });
  check('Scripts de la cámara registrados para el sitio permitido', scripts?.every((s) => s.matches.join() === `${BASE}/*` && s.runAt === 'document_start'), scripts?.map((s) => `${s.id}:${s.world}`).join(', '));

  await ctl.evaluate(async (base) => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...(settings || {}), remoteUrl: `${base}/remote/` } });
  }, BASE);

  // ---------- sesión
  const snap = await sw({ type: 'session:start' });
  check('Sesión iniciada', snap?.state?.active === true, snap?.identity?.peerId);
  const ready = await waitFor(async () => (await state())?.status === 'ready', { timeout: 25000 });
  check('Conectado al servidor de señalización (PeerJS)', !!ready);

  const popup = await browser.newPage();
  await popup.setViewport({ width: 360, height: 640 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForSelector('#qr svg');
  check('El panel muestra el código QR', await popup.$eval('#scan', (e) => !e.hidden));

  // ---------- celular
  const { identity } = await ctl.evaluate(() => chrome.storage.local.get('identity'));
  // Otro contexto (como otro dispositivo): sin la extensión y con su propio almacenamiento.
  const phoneCtx = await browser.createBrowserContext();
  await phoneCtx.overridePermissions(BASE, ['camera', 'microphone']);
  const phone = await phoneCtx.newPage();
  await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.goto(`${BASE}/remote/#id=${identity.peerId}&k=${identity.token}`);
  const startShown = await waitFor(() => phone.$eval('#start', (e) => !e.hidden), { timeout: 25000 });
  check('El celular se conecta y pide «Empezar»', !!startShown);
  check('La clave se borra de la barra de direcciones', !phone.url().includes('k='), phone.url());
  await phone.click('#start-btn');
  const streaming = await waitFor(async () => (await state())?.devices?.[0]?.streaming, { timeout: 20000 });
  check('El celular envía cámara y micrófono a la computadora', !!streaming);
  const dev = (await state()).devices[0];
  check('La computadora conoce la cámara y el micrófono del celular', dev.media?.cam?.on && dev.media?.mic?.on && dev.media.cam.w > 0, `${dev.name} · ${dev.media?.cam?.w}×${dev.media?.cam?.h} · micrófono ${dev.media?.mic?.mode}`);
  const phoneUi = await phone.evaluate(() => ({
    preview: document.querySelector('#preview').videoWidth,
    nr: document.querySelector('#mode [data-mode="nr"]').getAttribute('aria-checked'),
    live: document.querySelector('#live-text').textContent,
  }));
  check('El celular muestra su vista previa y el modo «Reducción de ruido»', phoneUi.preview > 0 && phoneUi.nr === 'true', JSON.stringify(phoneUi));

  // ---------- vista previa en el panel
  const popupLive = await waitFor(() => popup.evaluate(() => !document.querySelector('#live').hidden && document.querySelector('#preview').videoWidth > 0), { timeout: 15000 });
  check('El panel muestra la cámara del celular en vivo', !!popupLive);

  // ---------- videollamada de prueba
  const call = await browser.newPage();
  await call.setViewport({ width: 1280, height: 760 });
  await call.goto(`${BASE}/test/videollamada.html`, { waitUntil: 'networkidle0' });
  const devices = await call.evaluate(() => window.__test.listDevices());
  const camDev = devices.find((d) => d.deviceId === 'capturazo-camara');
  const micDev = devices.find((d) => d.deviceId === 'capturazo-microfono');
  check('El sitio ve «Capturazo · Cámara del celular»', camDev?.kind === 'videoinput' && camDev.label === 'Capturazo · Cámara del celular');
  check('El sitio ve «Capturazo · Micrófono del celular»', micDev?.kind === 'audioinput' && micDev.label === 'Capturazo · Micrófono del celular');
  check('Las cámaras reales siguen en la lista', devices.filter((d) => d.kind === 'videoinput').length >= 2, `${devices.length} dispositivos`);

  const tracks = await call.evaluate(() => window.__test.start('capturazo-camara', 'capturazo-microfono'));
  check('getUserMedia entrega las pistas del celular', tracks.length === 2 && tracks.some((t) => t.label === 'Capturazo · Cámara del celular') && tracks.find((t) => t.kind === 'video')?.settings.deviceId === 'capturazo-camara', tracks.map((t) => t.label).join(' + '));
  let stats = await waitFor(async () => { const s = await call.evaluate(() => window.__test.frameStats()); return isScene(s) ? s : null; }, { timeout: 15000 });
  check('La videollamada recibe la imagen del celular', !!stats, stats ? `${stats.w}×${stats.h} rgb(${stats.r | 0}, ${stats.g | 0}, ${stats.b | 0})` : JSON.stringify(await call.evaluate(() => window.__test.frameStats())));
  const hd = await waitFor(async () => { const s = await call.evaluate(() => window.__test.frameStats()); return s?.w >= 1280 ? s : null; }, { timeout: 20000 });
  check('La imagen llega en HD (1280×720)', !!hd, hd ? `${hd.w}×${hd.h}` : JSON.stringify(await call.evaluate(() => window.__test.frameStats())));
  const level = await waitFor(async () => { const v = await call.evaluate(() => window.__test.audioLevel()); return v > 0.01 ? v : null; }, { timeout: 10000 });
  check('La videollamada recibe el sonido del micrófono del celular', !!level, level ? `nivel ${level.toFixed(3)}` : JSON.stringify(await call.evaluate(() => window.__test.diag())));

  const using = await waitFor(async () => (await state())?.consumers?.some((c) => c.kind === 'page' && c.origin === new URL(BASE).hostname), { timeout: 5000 });
  check('El panel sabe qué sitio usa el celular', !!using);
  const phoneUses = await waitFor(async () => { const t = await phone.$eval('#live-text', (e) => e.textContent); return t.includes(new URL(BASE).hostname) ? t : null; }, { timeout: 5000 });
  check('El celular muestra quién lo está usando', !!phoneUses, phoneUses || '');

  // ---------- control remoto desde la computadora
  await sw({ type: 'phone:set', id: dev.id, set: { mode: 'normal' } });
  const normal = await waitFor(async () => (await state())?.devices?.[0]?.media?.mic?.mode === 'normal', { timeout: 8000 });
  const phoneNormal = await phone.$eval('#mode [data-mode="normal"]', (e) => e.getAttribute('aria-checked'));
  check('Micrófono «Normal» desde la computadora', normal && phoneNormal === 'true');
  const savedMode = await ctl.evaluate(async () => (await chrome.storage.sync.get('settings')).settings.micMode);
  await phone.click('#mode [data-mode="nr"]');
  const nrBack = await waitFor(async () => (await state())?.devices?.[0]?.media?.mic?.mode === 'nr', { timeout: 8000 });
  const savedNr = await waitFor(async () => (await ctl.evaluate(async () => (await chrome.storage.sync.get('settings')).settings.micMode)) === 'nr', { timeout: 4000 });
  check('«Reducción de ruido» desde el celular (y se guarda en la computadora)', nrBack && savedNr, `antes: ${savedMode}`);
  const levelAfter = await waitFor(async () => { const v = await call.evaluate(() => window.__test.audioLevel()); return v > 0.01 ? v : null; }, { timeout: 8000 });
  check('El sonido sigue llegando después de cambiar el micrófono', !!levelAfter);

  await sw({ type: 'phone:set', id: dev.id, set: { camOn: false } });
  stats = await waitFor(async () => { const s = await call.evaluate(() => window.__test.frameStats()); return isWaiting(s) ? s : null; }, { timeout: 8000 });
  check('Cámara apagada: el sitio ve la imagen de espera (sin cortar la llamada)', !!stats && (await call.evaluate(() => window.__test.tracks().every((t) => t.state === 'live'))));
  check('Cámara apagada en el celular', await phone.$eval('#cam-off', (e) => !e.hidden));
  await phone.click('#cam-btn');
  stats = await waitFor(async () => { const s = await call.evaluate(() => window.__test.frameStats()); return isScene(s) ? s : null; }, { timeout: 10000 });
  check('Cámara encendida desde el celular: vuelve la imagen', !!stats);

  // ---------- fotos y grabación
  const before = downloads().length;
  await sw({ type: 'snap' });
  const photo = await waitFor(() => downloads().find((f) => f.startsWith('Foto') && f.endsWith('.jpg')), { timeout: 15000 });
  const photoSize = photo ? fs.statSync(path.join(DL, 'Capturazo', photo)).size : 0;
  check('Foto tomada con el celular y guardada en Descargas › Capturazo', !!photo && photoSize > 20000, photo ? `${photo} · ${(photoSize / 1024) | 0} KB` : `${before} archivos`);
  const toastPhoto = await waitFor(async () => { const t = await phone.$eval('#toast', (e) => e.classList.contains('on') && e.textContent); return t || null; }, { timeout: 5000 });
  check('El celular confirma la foto', toastPhoto === 'Foto guardada en la computadora', toastPhoto || '');

  await phone.click('#rec-btn');
  const recOn = await waitFor(async () => (await state())?.rec, { timeout: 8000 });
  check('Grabación iniciada desde el celular', !!recOn);
  const badge = await ctl.evaluate(() => chrome.action.getBadgeText({}));
  check('El ícono muestra REC', badge === 'REC');
  const phoneRec = await waitFor(() => phone.$eval('#rec-pill', (e) => !e.hidden), { timeout: 5000 });
  check('El celular muestra que se está grabando', !!phoneRec);
  await sleep(3500);
  await sw({ type: 'rec:stop' });
  const video = await waitFor(() => downloads().find((f) => f.startsWith('Video') && (f.endsWith('.mp4') || f.endsWith('.webm'))), { timeout: 15000 });
  const videoSize = video ? fs.statSync(path.join(DL, 'Capturazo', video)).size : 0;
  check('Video con sonido guardado en Descargas › Capturazo', !!video && videoSize > 30000, video ? `${video} · ${(videoSize / 1024) | 0} KB` : '');

  // ---------- visor
  const visor = await browser.newPage();
  await visor.setViewport({ width: 1280, height: 720 });
  await visor.goto(`chrome-extension://${extId}/visor.html`);
  const visorLive = await waitFor(() => visor.evaluate(() => document.querySelector('#idle').hidden && document.querySelector('#video').videoWidth > 0), { timeout: 15000 });
  check('El visor muestra la cámara del celular', !!visorLive);
  const visorCams = await visor.$$eval('#cam-select option', (o) => o.length);
  check('El visor ofrece las cámaras del celular', visorCams >= 1, `${visorCams} cámaras`);

  // ---------- «Preferir el celular» cuando el sitio no elige cámara
  await ctl.evaluate(async () => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...settings, preferPhone: true } });
  });
  await sleep(300);
  const generic = await call.evaluate(() => window.__test.start('generic', 'generic'));
  check('«Preferir el celular» con getUserMedia({ video: true })', generic.every((t) => t.label.startsWith('Capturazo')), generic.map((t) => t.label).join(' + '));
  await ctl.evaluate(async () => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...settings, preferPhone: false } });
  });
  await sleep(300);
  const realCam = await call.evaluate(() => window.__test.start('generic', 'generic'));
  check('Sin la opción, el sitio recibe su cámara real', realCam.every((t) => !t.label.startsWith('Capturazo')), realCam.map((t) => t.label).join(' + '));

  // ---------- fin de la sesión
  await call.evaluate(() => window.__test.start('capturazo-camara', 'capturazo-microfono'));
  await waitFor(async () => isScene(await call.evaluate(() => window.__test.frameStats())), { timeout: 10000 });
  await sw({ type: 'session:stop' });
  const ended = await waitFor(() => phone.$eval('#gate-title', (e) => e.textContent === 'Sesión finalizada' && e.closest('.app:not(.ready)') ? e.textContent : null), { timeout: 10000 });
  check('Al detener la sesión el celular lo avisa y apaga la cámara', !!ended && (await phone.evaluate(() => !document.querySelector('#preview').srcObject)));
  stats = await waitFor(async () => { const s = await call.evaluate(() => window.__test.frameStats()); return isWaiting(s) ? s : null; }, { timeout: 10000 });
  check('La videollamada sigue viva con la imagen de espera', !!stats && (await call.evaluate(() => window.__test.tracks().every((t) => t.state === 'live'))));

  // Volver a iniciar: el sitio vuelve a recibir la imagen al reconectar el celular.
  await sw({ type: 'session:start' });
  const { identity: id2 } = await ctl.evaluate(() => chrome.storage.local.get('identity'));
  check('Código nuevo en cada sesión', id2.peerId !== identity.peerId);
  await phone.goto(`${BASE}/remote/#id=${id2.peerId}&k=${id2.token}`);
  await waitFor(() => phone.$eval('#start', (e) => !e.hidden), { timeout: 25000 });
  await phone.click('#start-btn');
  stats = await waitFor(async () => { const s = await call.evaluate(() => window.__test.frameStats()); return isScene(s) ? s : null; }, { timeout: 25000 });
  check('Al reconectar, la misma llamada vuelve a ver el celular', !!stats);
} catch (err) {
  check('Sin errores inesperados', false, err.stack || String(err));
} finally {
  await browser.close();
  fs.rmSync(PROFILE, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
process.exit(failed.length ? 1 : 0);
