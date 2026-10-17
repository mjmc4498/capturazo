#!/usr/bin/env python3
"""Genera extension/_locales/es/messages.json (los textos de la extensión).

Los textos se editan aquí, en un solo lugar, y el script escribe el JSON con el
formato de Chrome (placeholders con nombre para las sustituciones).

    python3 scripts/textos.py
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "extension" / "_locales" / "es" / "messages.json"

TEXTOS = {
    # Manifiesto
    "extName": "Capturazo: tu celular como cámara y micrófono",
    "extDescription": "Usa la cámara y el micrófono de tu celular en Chrome con un QR: elige la cámara, reduce el ruido, toma fotos y graba.",
    "actionTitle": "Capturazo — usa tu celular como cámara y micrófono",
    "cmdOpen": "Mostrar el código QR de Capturazo",

    # Panel
    "statusStarting": "Iniciando…",
    "statusStopped": "Detenido",
    "statusReady": "Listo para conectar",
    "statusConnecting": "Conectando…",
    "statusOffline": "Sin conexión",
    "statusConnectedOne": "Celular conectado",
    "statusConnectedMany": "{count} celulares conectados",
    "statusLive": "Transmitiendo",
    "qrAlt": "Código QR para usar tu celular como cámara y micrófono",
    "scanTitle": "Escanea con la cámara de tu celular",
    "scanBody": "Se abre en el navegador del celular. No necesitas instalar nada.",
    "stoppedTitle": "Sesión detenida",
    "stoppedBody": "Inicia una sesión para mostrar el código y conectar tu celular.",
    "start": "Iniciar",
    "stop": "Detener la sesión",
    "settings": "Ajustes",
    "errorNetwork": "No se pudo conectar con el servidor. Revisa tu conexión a internet; Capturazo seguirá reintentando.",
    "errorGeneric": "No se pudo iniciar la conexión. Cierra este panel y vuelve a abrirlo.",
    "cameras": "Cámaras del celular",
    "micLabel": "Micrófono",
    "modeNormal": "Normal",
    "modeNr": "Reducción de ruido",
    "mic": "Micrófono",
    "micToggle": "Encender o apagar el micrófono del celular",
    "camera": "Cámara",
    "camToggle": "Encender o apagar la cámara del celular",
    "flip": "Girar",
    "flipTitle": "Cambiar entre la cámara frontal y la trasera",
    "photo": "Foto",
    "photoTitle": "Tomar una foto con el celular y guardarla en Descargas › Capturazo",
    "photoFailed": "No hay cámara encendida para tomar la foto",
    "record": "Grabar",
    "stopRec": "Detener",
    "recTitle": "Grabar video y sonido del celular en Descargas › Capturazo",
    "recFailed": "No se pudo grabar: el celular no está transmitiendo",
    "openVisor": "Abrir el visor",
    "camOffShort": "Cámara del celular apagada",
    "connectingShort": "Conectando con el celular…",
    "devicesTitle": "Celulares",
    "connected": "Conectado",
    "disconnect": "Desconectar",
    "use": "Usar",
    "onAir": "Al aire",
    "waitingStart": "Esperando que toque «Empezar»",
    "justNow": "ahora",
    "siteEnable": "Activar",
    "siteReload": "Recargar la página",
    "siteOffSub": "Actívalo para usar el celular como cámara y micrófono aquí",
    "siteOnSub": "El celular aparece en la lista de cámaras y micrófonos",
    "siteEnabledSub": "Listo: elige «Capturazo · Cámara del celular» en este sitio",
    "siteUsing": "Este sitio está usando tu celular",
    "siteRestricted": "Chrome no permite extensiones en esta página",
    "savedPhoto": "Foto guardada en Descargas › Capturazo › {name}",
    "savedVideo": "Video guardado en Descargas › Capturazo › {name}",
    "copyLink": "Copiar enlace",
    "copyLinkTitle": "Copiar el enlace para abrirlo en el celular",
    "copied": "Copiado",
    "copyFailed": "No se pudo copiar",
    "showQr": "Otro celular",
    "showQrTitle": "Mostrar el código para conectar otro celular",
    "newCode": "Código nuevo",
    "newCodeTitle": "Crear un código nuevo y desconectar a todos",
    "newCodeConfirm": "¿Confirmar?",

    # Visor
    "visorTitle": "Capturazo · Visor",
    "visorHint": "F pantalla completa · P foto · R grabar · M espejo · H ocultar",
    "visorStoppedTitle": "Sesión detenida",
    "visorStoppedBody": "Abre el panel de Capturazo para iniciar una sesión.",
    "visorIdleTitle": "Conecta tu celular",
    "visorIdleBody": "Escanea este código con la cámara de tu celular. No necesitas instalar nada.",
    "visorStartTitle": "Tu celular está conectado",
    "visorStartBody": "Toca «Empezar» en la pantalla de {name} y permite la cámara y el micrófono.",
    "visorCamOffTitle": "Cámara apagada",
    "visorCamOffBody": "Enciende la cámara en {name} o desde los controles de abajo.",
    "visorConnectingTitle": "Conectando…",
    "visorConnectingBody": "Recibiendo la imagen de {name}.",
    "listenTitle": "Escuchar el micrófono del celular en esta computadora",
    "sinkTitle": "Salida de audio",
    "sinkDefault": "Salida predeterminada",
    "sinkUnnamed": "Salida de audio",
    "sinkShowNames": "Mostrar los nombres de las salidas…",
    "sinkNamesDenied": "Sin permiso de micrófono Chrome no muestra los nombres de las salidas",
    "mirrorTitle": "Espejo (M)",
    "rotateTitle": "Girar 90°",
    "fitTitle": "Llenar la ventana",
    "fullTitle": "Pantalla completa (F)",
    "cleanTitle": "Ocultar los controles (H) — ideal para capturar la ventana con OBS",
    "cleanOn": "Controles ocultos · pulsa H o Esc para mostrarlos",

    # Ajustes y bienvenida
    "welcomeTitle": "Bienvenido a Capturazo",
    "heroTitle": "Tu celular, ahora es la cámara y el micrófono de tu computadora",
    "heroBody": "Escanea un código QR y usa la cámara que quieras de tu celular —frontal, trasera o gran angular— y su micrófono, normal o con reducción de ruido, en tus videollamadas y grabaciones del navegador.",
    "step1Title": "Escanea el código",
    "step1Body": "Haz clic en el ícono de Capturazo (o pulsa Alt+Shift+C) y apunta la cámara del celular al QR.",
    "step2Title": "Toca «Empezar»",
    "step2Body": "Permite la cámara y el micrófono en el celular y elige la cámara y el modo del micrófono.",
    "step3Title": "Elige Capturazo",
    "step3Body": "En tu videollamada elige «Capturazo · Cámara del celular» y «Capturazo · Micrófono del celular».",
    "shortcutHint": "Atajo: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> abre el panel con el QR",
    "sitesTitle": "Dónde usar el celular",
    "sitesBody": "El celular aparece como cámara y micrófono solo en los sitios que permitas. Actívalo sitio por sitio desde el panel («Activar»), o en todos a la vez.",
    "allSites": "Todos los sitios",
    "allSitesSub": "Capturazo podrá agregar el celular a la lista de cámaras y micrófonos de cualquier sitio. Ningún sitio lo recibe si no lo eliges.",
    "sitesEmpty": "Aún no activaste ningún sitio.",
    "remove": "Quitar",
    "mediaTitle": "Video y audio",
    "quality": "Calidad del video",
    "qualitySub": "720p sirve para casi todas las videollamadas; 1080p necesita una buena red Wi-Fi.",
    "fps": "Cuadros por segundo",
    "fpsSub": "60 se ve más fluido, pero no todos los celulares lo permiten.",
    "micModeSub": "Reducción de ruido para hablar; Normal para música o sonido ambiente, sin filtros.",
    "photoFormat": "Fotos",
    "photoFormatSub": "Se toman con el celular y se guardan en Descargas › Capturazo.",
    "recFormat": "Videos",
    "recFormatSub": "Se graban en la computadora, con el sonido del micrófono del celular.",
    "callsTitle": "Videollamadas",
    "preferPhone": "Preferir el celular",
    "preferPhoneSub": "Si un sitio no deja elegir la cámara, usa la del celular mientras esté transmitiendo.",
    "fallbackPhone": "Usar el celular si falta la cámara",
    "fallbackPhoneSub": "En computadoras sin cámara o sin micrófono, el sitio recibe el celular en su lugar.",
    "wakeOnDemand": "Iniciar la sesión cuando un sitio la pida",
    "wakeOnDemandSub": "Si eliges la cámara del celular y no hay sesión, se prepara el código QR solo.",
    "sessionTitle": "Sesión",
    "newCodeEach": "Código nuevo en cada sesión",
    "newCodeEachSub": "Más privado: el código anterior deja de funcionar al detener la sesión.",
    "autoStart": "Iniciar al abrir Chrome",
    "autoStartSub": "La sesión empieza sola y el celular se reconecta sin escanear de nuevo.",
    "guideTitle": "Guía",
    "guideCallTitle": "Usarlo en una videollamada",
    "guideCallBody": "Activa el sitio desde el panel de Capturazo. En los ajustes de video y audio de la llamada elige <b>Capturazo · Cámara del celular</b> y <b>Capturazo · Micrófono del celular</b>. Si no aparecen, recarga la página. Usa audífonos en la computadora para que el celular no capte el sonido de la llamada.",
    "guideObsTitle": "Usarlo en OBS Studio u otros programas",
    "guideObsBody": "Abre el <b>visor</b> y, en OBS, agrega una fuente <b>Captura de ventana</b> con la ventana del visor (pulsa H para ocultar los controles). Para usarlo como cámara en cualquier programa de la computadora, activa la <b>cámara virtual</b> de OBS.",
    "guideAudioTitle": "El micrófono del celular en toda la computadora",
    "guideAudioBody": "En el visor pulsa <b>Escuchar</b> y elige como salida un cable de audio virtual instalado en tu computadora. Luego, en el otro programa, elige ese cable como micrófono.",
    "guideTipsTitle": "Consejos para la mejor imagen",
    "guideTipsBody": "Gira el celular en horizontal, conéctalo al cargador y apóyalo en un soporte. La cámara trasera suele tener mejor calidad que la frontal. Usa la misma red Wi-Fi en el celular y la computadora: la conexión es directa y más rápida.",
    "advancedTitle": "Avanzado",
    "remoteUrl": "Página del celular",
    "remoteUrlSub": "Dirección que abre el código QR. Déjala vacía para usar la de Capturazo.",
    "remoteUrlInvalid": "Escribe una dirección que empiece con https://",
    "reset": "Restablecer",
    "saved": "Guardado",
    "madeBy": "Creado por Miguel Mogrovejo",
    "privacy": "Privacidad",
    "licenses": "Licencias",
}


def entry(text):
    names = re.findall(r"\{(\w+)\}", text)
    if not names:
        return {"message": text}
    message = text
    placeholders = {}
    for i, name in enumerate(names, 1):
        message = message.replace("{" + name + "}", f"${name.upper()}$")
        placeholders[name] = {"content": f"${i}"}
    return {"message": message, "placeholders": placeholders}


OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({k: entry(v) for k, v in TEXTOS.items()}, ensure_ascii=False, indent=2) + "\n")
print("  ", OUT.relative_to(ROOT), f"({len(TEXTOS)} textos)")
