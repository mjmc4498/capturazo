// Capturazo — configuración compartida por el service worker, el popup, el visor y los ajustes.

// Página de la cámara que se abre en el celular (carpeta /remote publicada en GitHub
// Pages). Si la publicas en otra dirección, cámbiala aquí o en Ajustes › Avanzado.
export const REMOTE_URL = 'https://mjmc4498.github.io/capturazo/';

// Prefijo de los identificadores de sesión en el servidor de señalización PeerJS.
export const ID_PREFIX = 'capturazo-';

// Worker de Cloudflare que entrega credenciales temporales del servidor de
// retransmisión (TURN) para redes que bloquean la conexión directa. Capturazo
// comparte el Worker de Presentazo (misma cuenta, mismo límite de consumo); la
// carpeta /cloudflare tiene una copia por si prefieres desplegar uno propio.
// Vacío = solo conexión directa.
export const ICE_ENDPOINT = 'https://mando-turn.mjmc4498.workers.dev/ice';

// Servidores públicos para la conexión directa cuando el Worker no responde.
export const FALLBACK_ICE = {
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }],
};

// Identificadores de la cámara y el micrófono del celular en las páginas web.
export const CAM_ID = 'capturazo-camara';
export const MIC_ID = 'capturazo-microfono';

// Acceso a los sitios: permiso opcional. Se concede por sitio («Usar en este sitio»
// en el panel) o para todos a la vez desde los ajustes.
export const ALL_SITES = { origins: ['https://*/*', 'http://*/*'] };

export const DEFAULT_SETTINGS = {
  remoteUrl: '',
  autoStart: false,
  newCodeEachSession: true,
  wakeOnDemand: true,
  preferPhone: false,
  fallbackPhone: true,
  quality: '720',
  fps: 30,
  micMode: 'nr',
  photoFormat: 'jpeg',
  recFormat: 'mp4',
  showToasts: true,
};

export async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.sync.set({ settings: next });
  return next;
}

export function buildRemoteUrl(base, peerId, token) {
  const url = new URL(base || REMOTE_URL);
  url.hash = new URLSearchParams({ id: peerId, k: token }).toString();
  return url.toString();
}

// Patrón de permiso de un sitio («https://meet.example.com/*»), o null si Chrome no
// permite extensiones ahí.
export function originPattern(url = '') {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.hostname === 'chromewebstore.google.com' || (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'))) return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

export const hasAllSites = () => chrome.permissions.contains(ALL_SITES);

export async function grantedOrigins() {
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.filter((o) => /^https?:\/\//.test(o));
}

// Chrome solo muestra su diálogo si se llama directamente desde un clic del usuario.
export const requestOrigins = (origins) => chrome.permissions.request({ origins }).catch(() => false);
export const removeOrigins = (origins) => chrome.permissions.remove({ origins }).catch(() => false);
