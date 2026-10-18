# Registro de cambios

Todas las versiones de la extensión Capturazo. El número de versión de cada paquete
debe ser mayor que el anterior para que la Chrome Web Store lo acepte.

## 1.0.1 — 17 de octubre de 2026

- **Menor latencia.** El video ya no espera al audio para sincronizarse (el audio del
  celular viaja en su propio «stream»), los receptores no agregan búfer
  (`jitterBufferTarget = 0`), el celular prefiere H.264 (codificación por hardware),
  el audio va en paquetes de 10 ms, se mantienen los cuadros por segundo antes que la
  resolución y la página descarta los cuadros viejos si se atrasa.
- Si el celular se reconecta sin detener la sesión, los sitios, el visor y el panel
  reciben de inmediato su señal nueva.
- Nueva medición del retardo real de punta a punta: `npm run test:latencia`
  (unos 35–40 ms en el mismo equipo, a 30 cuadros por segundo).
- El empaquetado ya no deja copias de conflicto de iCloud en `dist/capturazo`.
- Personaje de la escena de demostración rediseñado: el cabello ya no parece un casco
  (volumen detrás de la cabeza, raya al lado, flequillo y patillas). Se regeneraron
  las capturas, las imágenes de la tienda y la presentación.

## 1.0.0 — 17 de octubre de 2026

Primera versión.

- **El celular como cámara y micrófono** de la computadora, conectado por código QR
  (WebRTC directo y cifrado, con retransmisión de Cloudflare para redes
  restrictivas). Sin apps ni cuentas: se abre en el navegador del celular.
- **Elegir la cámara:** frontal, trasera, gran angular, ultra gran angular o
  teleobjetivo, con nombres claros también en Android; botón para girar, linterna,
  vista previa en espejo y calidad de 480p, 720p o 1080p a 24, 30 o 60 cuadros.
- **Micrófono con «Reducción de ruido» o «Normal»**, elección del micrófono del
  celular y medidor de nivel.
- **Cámara y micrófono en los sitios web:** «Capturazo · Cámara del celular» y
  «Capturazo · Micrófono del celular» en la lista de dispositivos de los sitios que
  actives (sitio por sitio desde el panel, o todos). La llamada no se corta si el
  celular se reconecta, cambia de cámara o la apaga. Opciones para preferir el
  celular y para usarlo en computadoras sin cámara.
- **Fotos** tomadas con el celular y **grabación** con su sonido (MP4 o WebM), en
  Descargas › Capturazo, desde el celular, el panel o el visor.
- **Visor** a pantalla completa (espejo, girar, llenar, controles que se ocultan,
  escuchar el micrófono y elegir la salida de audio) y **control remoto** de la
  cámara y el micrófono desde la computadora.
- Varios celulares a la vez, con el que está al aire elegible desde el panel.
- Prueba de punta a punta con 43 comprobaciones.
