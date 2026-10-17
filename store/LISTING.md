# Ficha para la Chrome Web Store — Capturazo

Todo lo que pide el [Panel del desarrollador](https://chrome.google.com/webstore/devconsole), listo para copiar y pegar.

---

## 1. Paquete

| Campo | Valor |
|---|---|
| Archivo para subir | `dist/capturazo-1.0.0.zip` · versión 1.0.0 |
| Autor | Miguel Mogrovejo |

> Antes de enviar a revisión publica el repositorio `capturazo` con GitHub Pages (ver README, paso 1): la extensión abre `https://mjmc4498.github.io/capturazo/` en el celular y la política de privacidad vive en esa misma dirección.

---

## 2. Pestaña «Ficha de la tienda»

### Idioma: Español

**Nombre** (viene del manifiesto, 45 caracteres)
```
Capturazo: tu celular como cámara y micrófono
```

**Resumen** (viene del manifiesto, 117/132 caracteres)
```
Usa la cámara y el micrófono de tu celular en Chrome con un QR: elige la cámara, reduce el ruido, toma fotos y graba.
```

**Descripción**

> Sin nombres de otros productos ni listas de palabras clave (Botonazo fue rechazado una vez por «Spam de palabras clave» por una lista de servicios). Solo se habla de «videollamadas» en general.

```
Convierte tu celular en la cámara y el micrófono de tu computadora. Escanea un código QR, elige la cámara que quieras y úsala en tus videollamadas y grabaciones del navegador. Sin apps, sin cables y sin cuentas.

📱 TU CELULAR, CÁMARA DE LA COMPUTADORA
• Elige la cámara: frontal, trasera, gran angular, ultra gran angular o teleobjetivo (según tu celular).
• Calidad de 480p, 720p o 1080p, a 24, 30 o 60 cuadros por segundo.
• Gira entre la cámara frontal y la trasera con un toque, y enciende la linterna si tu celular la tiene.

🎙 MICRÓFONO CON REDUCCIÓN DE RUIDO
• Modo «Reducción de ruido» para hablar: menos ruido de fondo, sin eco y con volumen parejo.
• Modo «Normal» para música o sonido ambiente, sin filtros.
• Elige el micrófono del celular o unos audífonos conectados a él.

💻 EN TUS VIDEOLLAMADAS
• El celular aparece como «Capturazo · Cámara del celular» y «Capturazo · Micrófono del celular» en la lista de dispositivos del sitio.
• Actívalo sitio por sitio con un clic desde el panel de Capturazo.
• Si la computadora no tiene cámara, el sitio puede usar el celular en su lugar.
• Si el celular se reconecta o cambias de cámara, la llamada no se corta.

📸 FOTOS, VIDEO Y VISOR
• Toma fotos con el celular y guárdalas al instante en Descargas › Capturazo.
• Graba video con el sonido del celular en MP4 o WebM.
• Abre el visor para ver la cámara en grande, a pantalla completa, en espejo o girada, y capturar su ventana con tu programa de transmisión.

🕹 CONTROL DESDE LA COMPUTADORA
• Cambia de cámara, enciende o apaga la cámara y el micrófono y elige el modo del micrófono desde el panel o el visor, sin tocar el celular.

CÓMO FUNCIONA
1. Haz clic en el ícono de Capturazo (o pulsa Alt+Shift+C) y escanea el código QR.
2. En el celular toca «Empezar» y permite la cámara y el micrófono.
3. En tu videollamada elige «Capturazo · Cámara del celular» y «Capturazo · Micrófono del celular».

PRIVADO Y SEGURO
• Conexión directa y cifrada de extremo a extremo (WebRTC) entre tu celular y tu computadora: el video y el sonido no pasan por servidores del desarrollador.
• El celular y el panel muestran siempre qué sitio está usando tu cámara.
• El acceso a los sitios es opcional: lo das sitio por sitio y lo quitas cuando quieras.
• Sin cuentas, sin anuncios, sin analítica. Capturazo no recopila datos personales.
• Tus fotos y videos se guardan solo en tu computadora.
• Genera un código nuevo en cualquier momento para desconectar a todos.

Creado por Miguel Mogrovejo.
```

**Categoría:** Productividad › Comunicación

**Idioma:** Español

---

## 3. Recursos gráficos

| Recurso | Archivo | Tamaño |
|---|---|---|
| Ícono de la tienda | `store/icon-128.png` | 128×128 |
| Captura 1 | `store/screenshots/1-tu-celular-es-tu-camara.png` | 1280×800 |
| Captura 2 | `store/screenshots/2-en-tus-videollamadas.png` | 1280×800 |
| Captura 3 | `store/screenshots/3-elige-camara-y-microfono.png` | 1280×800 |
| Captura 4 | `store/screenshots/4-fotos-y-grabacion.png` | 1280×800 |
| Captura 5 | `store/screenshots/5-conecta-con-un-qr.png` | 1280×800 |
| Mosaico promocional pequeño | `store/promo-small-440x280.png` | 440×280 |
| Mosaico de marquesina (opcional) | `store/promo-marquee-1400x560.png` | 1400×560 |

---

## 4. Enlaces

| Campo | Valor |
|---|---|
| Sitio web oficial | `https://mjmc4498.github.io/capturazo/` |
| URL de asistencia | `https://github.com/mjmc4498/capturazo/issues` |
| Política de privacidad | `https://mjmc4498.github.io/capturazo/privacy.html` |

---

## 5. Pestaña «Prácticas de privacidad»

**Descripción del propósito único**
```
Capturazo permite usar la cámara y el micrófono del celular del usuario en su computadora. Al escanear un código QR, el celular abre una página web que envía su cámara y su micrófono a la extensión por una conexión WebRTC directa y cifrada. La extensión los ofrece como cámara y micrófono en los sitios que el usuario activa (por ejemplo, su videollamada), los muestra en un visor y guarda las fotos y los videos que el usuario pide.
```

**Justificación de permisos**

`offscreen`
```
Mantiene en segundo plano la conexión WebRTC con el celular del usuario (los service workers no pueden usar WebRTC), recibe su cámara y su micrófono, los reparte con conexiones WebRTC locales a los sitios que el usuario eligió, al visor y al panel, y crea con MediaRecorder el archivo de video cuando el usuario pulsa «Grabar». Motivos: WEB_RTC y BLOBS.
```

`scripting`
```
Registra los scripts de Capturazo (chrome.scripting.registerContentScripts) solo en los sitios a los que el usuario dio acceso, para agregar «Capturazo · Cámara del celular» y «Capturazo · Micrófono del celular» a la lista de dispositivos del sitio antes de que la página la pida. Al activar un sitio, también los inserta en las pestañas de ese sitio que ya están abiertas, para no tener que recargarlas.
```

`downloads`
```
Guarda en la carpeta Descargas › Capturazo las fotos y los videos que el usuario pide con los botones «Foto» y «Grabar».
```

`storage`
```
Guarda los ajustes del usuario (calidad del video, modo del micrófono, formatos de fotos y videos, sitios preferidos) y el identificador aleatorio de la sesión para que el celular pueda reconectarse.
```

`activeTab`
```
Cuando el usuario abre el panel de Capturazo, muestra el sitio de la pestaña actual para que pueda activarlo con un clic («Activar»), sin pedir acceso a todos los sitios.
```

Permisos de host opcionales (`optional_host_permissions`: `https://*/*`, `http://*/*`)
```
No se piden al instalar: el paquete no declara host_permissions. Capturazo los solicita en tiempo de ejecución con chrome.permissions.request y solo para el sitio que el usuario activa con el botón «Activar» del panel (por ejemplo, https://reunion.example.com/*), o para todos los sitios si el usuario activa «Todos los sitios» en los ajustes. En esos sitios, Capturazo agrega la cámara y el micrófono del celular a la lista de dispositivos de la página (navigator.mediaDevices) y entrega la señal del celular solo cuando la página los usa porque el usuario los eligió. Capturazo no lee, guarda ni envía el contenido de las páginas. El usuario puede quitar cada sitio en Ajustes › Dónde usar el celular.
```

**¿Usas código remoto?** → **No.** Todo el JavaScript va incluido en el paquete (PeerJS y el generador de QR están en `lib/`). La conexión con el servidor de señalización de PeerJS solo intercambia datos de conexión, no código.

**Uso de datos** — marca solo:
- ☑ **Comunicaciones personales** — el video y el sonido de la cámara y el micrófono del celular del usuario viajan entre sus propios dispositivos, cifrados de punto a punto, y nunca llegan al desarrollador.

Deja sin marcar **Contenido del sitio web**: Capturazo no lee las páginas, solo agrega dispositivos a su lista.

Y las tres certificaciones:
- ☑ No vendo ni transfiero datos de usuarios a terceros fuera de los casos de uso aprobados.
- ☑ No uso ni transfiero datos de usuarios para fines no relacionados con el propósito único del elemento.
- ☑ No uso ni transfiero datos de usuarios para determinar la solvencia crediticia ni para otorgar préstamos.

---

## 6. Instrucciones para el revisor (campo «Notas para el revisor», opcional)

```
1. Al instalar se abre la bienvenida de Capturazo.
2. Abre cualquier sitio web de videollamadas o de prueba de cámara (por ejemplo, una página que liste las cámaras con navigator.mediaDevices) y haz clic en el ícono de Capturazo: se muestra un código QR y la tarjeta del sitio con el botón «Activar».
3. Pulsa «Activar» y acepta el diálogo de Chrome (permiso opcional solo para ese sitio).
4. Escanea el QR con un celular (o pulsa «Copiar enlace» y ábrelo en otro dispositivo con cámara) y toca «Empezar».
5. En el sitio elige «Capturazo · Cámara del celular» y «Capturazo · Micrófono del celular». El panel muestra la cámara en vivo y permite cambiar de cámara, elegir «Normal» o «Reducción de ruido», tomar fotos y grabar (se guardan en Descargas › Capturazo). «Abrir el visor» la muestra a pantalla completa.
No se necesita cuenta ni credenciales.
```

---

## 7. Distribución

- **Visibilidad:** Pública
- **Regiones:** Todas
- **Precio:** Gratis
