// Capturazo — service worker.
// Coordina la sesión (documento offscreen con la conexión WebRTC), registra la cámara
// y el micrófono del celular en los sitios permitidos, y guarda fotos y videos.

import { DEFAULT_SETTINGS, ID_PREFIX, getSettings, grantedOrigins, saveSettings } from './config.js';

const OFFSCREEN_PATH = 'offscreen.html';
const SCRIPTS = [
  { id: 'capturazo-main', js: ['content/main.js'], world: 'MAIN' },
  { id: 'capturazo-isolated', js: ['lib/relay.js', 'content/isolated.js'], world: 'ISOLATED' },
];
const EMPTY_STATE = { active: false, status: 'idle', error: null, devices: [], activeId: null, consumers: [], rec: null, lastSave: null };
const SELF = new URL(chrome.runtime.getURL('')).origin;

// ---------------------------------------------------------------- ajustes

let settings = { ...DEFAULT_SETTINGS };
const settingsReady = getSettings().then((s) => { settings = s; });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    toOffscreen({ type: 'settings', settings });
  }
});

// ---------------------------------------------------------------- estado de la sesión

let state = null;

async function loadState() {
  if (!state) {
    const { state: saved } = await chrome.storage.session.get('state');
    state = { ...EMPTY_STATE, ...(saved || {}) };
  }
  return state;
}

async function patchState(patch) {
  await loadState();
  state = { ...state, ...patch };
  await chrome.storage.session.set({ state });
  updateBadge();
  return state;
}

function updateBadge() {
  const s = state || EMPTY_STATE;
  if (s.active && s.rec) {
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF3B30' });
  } else {
    const count = s.active ? s.devices.length : 0;
    chrome.action.setBadgeText({ text: count ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#0A84FF' });
  }
  chrome.action.setBadgeTextColor?.({ color: '#FFFFFF' });
}

// ---------------------------------------------------------------- identidad

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

function randomId(length) {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => ALPHABET[b & 31]).join('');
}

let identityPromise = null;

function getIdentity(regenerate = false) {
  if (regenerate || !identityPromise) {
    identityPromise = (async () => {
      let identity = regenerate ? null : (await chrome.storage.local.get('identity')).identity;
      if (!identity) {
        identity = { peerId: ID_PREFIX + randomId(16), token: randomId(16) };
        await chrome.storage.local.set({ identity });
      }
      return identity;
    })();
  }
  return identityPromise;
}

// ---------------------------------------------------------------- documento offscreen

let creatingOffscreen = null;

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['WEB_RTC', 'BLOBS'],
      justification: 'Recibir la cámara y el micrófono del celular por WebRTC, repartirlos a las páginas que los usan y crear los archivos de fotos y videos.',
    })
    .finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}

async function closeOffscreen(reason) {
  if (!(await hasOffscreen())) return;
  await chrome.runtime.sendMessage({ to: 'offscreen', type: 'stop', reason }).catch(() => {});
  await chrome.offscreen.closeDocument().catch(() => {});
}

async function toOffscreen(msg) {
  if (!(await hasOffscreen())) return null;
  // «to» va al final: los mensajes reenviados desde el panel traen su propio «to: 'sw'».
  return chrome.runtime.sendMessage({ ...msg, to: 'offscreen' }).catch(() => null);
}

// ---------------------------------------------------------------- cámara y micrófono en los sitios

// Los scripts se registran solo para los sitios que el usuario permitió (uno por uno
// desde el panel, o todos desde los ajustes) y se insertan antes que la página, para
// que el celular aparezca en su lista de cámaras y micrófonos.
let scriptsQueue = Promise.resolve();

function syncContentScripts() {
  scriptsQueue = scriptsQueue.then(async () => {
    const origins = await grantedOrigins();
    const ids = SCRIPTS.map((s) => s.id);
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids }).catch(() => []);
    if (!origins.length) {
      if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) }).catch(() => {});
      return;
    }
    const scripts = SCRIPTS.map((s) => ({ ...s, matches: origins, runAt: 'document_start', allFrames: true, persistAcrossSessions: true }));
    if (existing.length === scripts.length) await chrome.scripting.updateContentScripts(scripts);
    else {
      if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) }).catch(() => {});
      await chrome.scripting.registerContentScripts(scripts);
    }
  }).catch((err) => console.warn('[Capturazo] scripts', err));
  return scriptsQueue;
}

// Al permitir un sitio, las pestañas que ya están abiertas reciben los scripts al
// instante: el celular aparece en su lista sin recargar.
async function injectInto(tabId) {
  const target = { tabId, allFrames: true };
  for (const s of SCRIPTS) {
    await chrome.scripting.executeScript({ target, files: s.js, world: s.world, injectImmediately: true }).catch(() => {});
  }
}

async function injectOpenTabs(origins) {
  if (!origins?.length) return;
  const tabs = await chrome.tabs.query({ url: origins }).catch(() => []);
  for (const tab of tabs) if (tab.id != null) injectInto(tab.id);
}

chrome.permissions.onAdded.addListener(async ({ origins }) => {
  await syncContentScripts();
  injectOpenTabs(origins);
});
chrome.permissions.onRemoved.addListener(() => syncContentScripts());

// ---------------------------------------------------------------- sesión

async function startSession() {
  await settingsReady;
  const s = await loadState();
  if (!s.active) {
    if (settings.newCodeEachSession) await getIdentity(true);
    await patchState({ ...EMPTY_STATE, active: true, status: 'starting' });
  }
  await ensureOffscreen();
  return snapshot();
}

async function stopSession() {
  await closeOffscreen('stopped');
  await patchState({ ...EMPTY_STATE });
  return snapshot();
}

async function resetCode() {
  await closeOffscreen('revoked');
  await getIdentity(true);
  const s = await loadState();
  await patchState({ devices: [], activeId: null, consumers: [], rec: null, status: s.active ? 'starting' : 'idle' });
  if (s.active) await ensureOffscreen();
  return snapshot();
}

async function snapshot() {
  return { state: await loadState(), identity: await getIdentity() };
}

// ---------------------------------------------------------------- archivos

async function saveFile(msg) {
  if (typeof msg.url !== 'string' || !msg.url.startsWith(`blob:${SELF}/`)) return;
  if (typeof msg.filename !== 'string' || !/^Capturazo\/[\w .\-áéíóúñÁÉÍÓÚÑ]+\.(jpg|png|mp4|webm)$/.test(msg.filename)) return;
  try {
    await chrome.downloads.download({ url: msg.url, filename: msg.filename, conflictAction: 'uniquify', saveAs: false });
    await patchState({ lastSave: { kind: msg.kind === 'video' ? 'video' : 'photo', filename: msg.filename.slice('Capturazo/'.length), size: Number(msg.size) || 0, at: Date.now() } });
  } catch (err) {
    console.warn('[Capturazo] descarga', err);
  }
}

// ---------------------------------------------------------------- mensajes

const forward = (type) => (msg) => toOffscreen({ ...msg, type });

// Páginas de la extensión (panel, visor, ajustes) y documento offscreen.
const handlers = {
  'session:start': () => startSession(),
  'session:stop': () => stopSession(),
  'session:reset': () => resetCode(),
  'session:get': () => snapshot(),
  'phone:set': forward('phone'),
  snap: forward('snap'),
  use: forward('use'),
  'rec:start': forward('rec:start'),
  'rec:stop': forward('rec:stop'),
  'device:kick': forward('kick'),
  'site:enabled': async (msg) => {
    await syncContentScripts();
    if (Number.isInteger(msg.tabId)) await injectInto(msg.tabId);
    return { ok: true };
  },
  'scripts:sync': () => syncContentScripts(),

  // documento offscreen
  identity: () => getIdentity(),
  'offscreen:ready': async () => { await settingsReady; return { settings }; },
  status: (msg) => patchState({ status: msg.status, error: msg.error || null }),
  sync: (msg) => patchState({ devices: msg.devices || [], activeId: msg.activeId ?? null, consumers: msg.consumers || [], rec: msg.rec || null }),
  joined: () => null,
  left: () => null,
  prefs: (msg) => saveSettings(msg.patch || {}),
  download: (msg) => saveFile(msg),
};

// Scripts de contenido (la cámara y el micrófono del celular dentro de una página).
const contentHandlers = {
  // La página eligió la cámara o el micrófono del celular: si no hay sesión, se inicia
  // para que el panel muestre el QR.
  'consumer:wake': async () => {
    await settingsReady;
    const s = await loadState();
    if (!s.active && settings.wakeOnDemand) await startSession();
    return { active: (await loadState()).active };
  },
  'cam:settings': async () => {
    await settingsReady;
    const s = await loadState();
    return { preferPhone: settings.preferPhone, fallbackPhone: settings.fallbackPhone, live: s.active && s.devices.some((d) => d.streaming) };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.to !== 'sw' || sender.id !== chrome.runtime.id) return;
  const trusted = sender.origin === SELF || (sender.url || '').startsWith(`${SELF}/`);
  const handler = trusted ? handlers[msg.type] || contentHandlers[msg.type] : contentHandlers[msg.type];
  if (!handler) return;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then((res) => sendResponse(res ?? null), (err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});

// ---------------------------------------------------------------- ciclo de vida

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await chrome.storage.session.set({ state: { ...EMPTY_STATE } });
  state = null;
  updateBadge();
  await syncContentScripts();
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options.html#bienvenida') });
});

chrome.runtime.onStartup.addListener(async () => {
  await settingsReady;
  syncContentScripts();
  if (settings.autoStart) startSession();
});

loadState().then(updateBadge);
