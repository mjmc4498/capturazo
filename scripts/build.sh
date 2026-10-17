#!/usr/bin/env bash
# Empaqueta la extensión para la Chrome Web Store.
#
#   ./scripts/build.sh          → dist/capturazo-<versión>.zip   (lo que se sube a la tienda)
#                                 dist/capturazo/                (carpeta para «Cargar extensión sin empaquetar»;
#                                                             la ruta no cambia entre versiones)
#   ./scripts/build.sh --crx    → además dist/capturazo-<versión>.crx (instalación fuera de la tienda)
#
# La clave privada del CRX se guarda en keys/capturazo.pem: no la compartas ni la subas a git.

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['version'])")
ZIP="dist/capturazo-${VERSION}.zip"
mkdir -p dist

echo "▸ Validando la extensión ${VERSION}…"
python3 - <<'PY'
import json, pathlib, re, sys
ext = pathlib.Path("extension")
errors = []
manifest = json.loads((ext / "manifest.json").read_text())

for size, path in {**manifest["icons"], **manifest["action"]["default_icon"]}.items():
    if not (ext / path).exists():
        errors.append(f"falta el ícono {path}")

locales = {p.parent.name: json.loads(p.read_text()) for p in (ext / "_locales").glob("*/messages.json")}
base = set(locales.get(manifest["default_locale"], {}))
for lang, msgs in locales.items():
    if set(msgs) != base:
        errors.append(f"_locales/{lang} no tiene las mismas claves que {manifest['default_locale']}")
    if len(msgs["extDescription"]["message"]) > 132:
        errors.append(f"descripción en {lang} supera 132 caracteres")
    if len(msgs["extName"]["message"]) > 75:
        errors.append(f"nombre en {lang} supera 75 caracteres")

for js in ext.rglob("*.js"):
    text = js.read_text()
    if "sourceMappingURL" in text:
        errors.append(f"{js} referencia un sourcemap inexistente")
    if re.search(r"\beval\s*\(|new Function\s*\(", text):
        errors.append(f"{js} usa eval/new Function (prohibido en MV3)")

used = set()
for f in ext.glob("*.html"):
    used |= set(re.findall(r'data-i18n(?:-html|-title|-aria)?="([^"]+)"', f.read_text()))
for f in ext.glob("*.js"):
    used |= set(re.findall(r"\bt\('([A-Za-z0-9]+)'", f.read_text()))
for key in sorted(used - base):
    errors.append(f"falta el texto «{key}» en _locales")

for path in ["content/main.js", "content/isolated.js", "lib/relay.js", "offscreen.html", "popup.html", "visor.html", "options.html"]:
    if not (ext / path).exists():
        errors.append(f"falta {path}")

if errors:
    print("\n".join("  ✗ " + e for e in errors))
    sys.exit(1)
print("  ✓ manifiesto, íconos, textos y scripts correctos")
PY

if command -v node >/dev/null; then
  for f in extension/*.js extension/content/*.js extension/lib/i18n.js extension/lib/relay.js remote/app.js; do node --check "$f"; done
  echo "  ✓ sintaxis JavaScript"
fi

rm -f "$ZIP"
(cd extension && zip -qr -X -9 "../$ZIP" . -x '.*' -x '*/.*' -x '__MACOSX/*')
echo "▸ ZIP listo: $ZIP ($(du -h "$ZIP" | cut -f1))"

UNPACKED="dist/capturazo"
rm -rf "$UNPACKED"
unzip -q "$ZIP" -d "$UNPACKED"
echo "▸ Carpeta para «Cargar extensión sin empaquetar»: $UNPACKED"

if [[ "${1:-}" == "--crx" ]]; then
  CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
  [[ -x "$CHROME" ]] || CHROME="$(command -v google-chrome || command -v chromium || true)"
  [[ -n "$CHROME" ]] || { echo "No se encontró Chrome para empaquetar el CRX"; exit 1; }
  mkdir -p keys
  TMP_PROFILE=$(mktemp -d)
  ARGS=(--pack-extension="$PWD/extension" --user-data-dir="$TMP_PROFILE" --no-message-box)
  [[ -f keys/capturazo.pem ]] && ARGS+=(--pack-extension-key="$PWD/keys/capturazo.pem")
  "$CHROME" "${ARGS[@]}" >/dev/null 2>&1 || true
  rm -rf "$TMP_PROFILE"
  [[ -f extension.pem ]] && mv extension.pem keys/capturazo.pem
  if [[ -f extension.crx ]]; then
    mv extension.crx "dist/capturazo-${VERSION}.crx"
    echo "▸ CRX listo: dist/capturazo-${VERSION}.crx (clave: keys/capturazo.pem)"
  else
    echo "No se pudo generar el CRX"; exit 1
  fi
fi
