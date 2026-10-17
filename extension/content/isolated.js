// Capturazo — puente entre la página y la extensión (mundo aislado).
// Cuando la página elige la cámara o el micrófono del celular, abre la conexión local
// con la extensión (lib/relay.js) y le pasa la señal al script de la página
// (content/main.js) a través de un elemento <video> compartido por los dos mundos.

(() => {
  'use strict';
  if (globalThis.__capturazoIsolated) return;
  globalThis.__capturazoIsolated = true;

  const EV = 'capturazo:';
  let relay = null;
  let woke = false;
  let releaseTimer = 0;

  // El elemento reproduce la señal en silencio (Chrome necesita que alguien la consuma
  // para que el audio llegue) y es el puente para que la página tome el MediaStream.
  const holder = document.createElement('video');
  holder.muted = true;
  holder.playsInline = true;

  function toMain(name, detail) {
    document.dispatchEvent(new CustomEvent(EV + name, { detail: JSON.stringify(detail ?? null) }));
  }

  function handoff(stream) {
    if (holder.srcObject !== stream) holder.srcObject = stream;
    holder.play().catch(() => {});
    document.dispatchEvent(new MouseEvent(EV + 'stream', { relatedTarget: holder }));
  }

  function need() {
    clearTimeout(releaseTimer);
    if (relay) {
      if (relay.stream.getTracks().length) handoff(relay.stream);
      toMain('state', relay.state);
      return;
    }
    woke = false;
    relay = globalThis.CapturazoRelay.connect({
      kind: 'page',
      onStream: (stream) => handoff(stream),
      onState: (state) => toMain('state', state),
      onIdle: () => {
        // Sin sesión: se pide una sola vez que empiece, para que el panel muestre el QR.
        if (woke) return;
        woke = true;
        chrome.runtime.sendMessage({ to: 'sw', type: 'consumer:wake' }).catch(() => {});
      },
    });
  }

  function release() {
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      relay?.close();
      relay = null;
      holder.srcObject = null;
    }, 3000);
  }

  async function answer(e) {
    let id;
    try { id = JSON.parse(e.detail)?.id; } catch {}
    if (!Number.isInteger(id)) return;
    const res = await chrome.runtime.sendMessage({ to: 'sw', type: 'cam:settings' }).catch(() => null);
    toMain('answer', { id, preferPhone: !!res?.preferPhone, fallbackPhone: !!res?.fallbackPhone, live: !!res?.live });
  }

  document.addEventListener(EV + 'need', need);
  document.addEventListener(EV + 'release', release);
  document.addEventListener(EV + 'ask', answer);
  document.addEventListener(EV + 'hello', () => toMain('ready'));
  toMain('ready');
})();
