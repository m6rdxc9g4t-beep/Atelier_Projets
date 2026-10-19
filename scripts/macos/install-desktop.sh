#!/bin/bash
# Atelier Projets — crée l'application de bureau macOS « Atelier Projets.app » (Electron).
#
#   npm run app:install              → ~/Applications/Atelier Projets.app
#   npm run app:install -- <dossier> → dans un autre dossier (ex. ~/Desktop)
#
# Une vraie application : sa propre fenêtre et son icône dans le Dock, sans navigateur. Au lancement, elle met
# à jour la compilation si le dépôt a changé (git pull), démarre l'API et l'interface ; Cmd+Q arrête tout.
# Journal : ~/Library/Logs/Atelier_Projets/app.log
#
# L'application contient Electron et un petit lanceur qui pointe vers ce dépôt : le code de l'application
# reste dans le dépôt (desktop/main.cjs), un « git pull » suffit pour la mettre à jour. Relancer ce script
# après un déplacement du dépôt, un changement d'installation de Node, ou une mise à jour d'Electron.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "✘ Ce script crée une application macOS : à lancer sur le Mac." >&2
  exit 1
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
TARGET_DIR="${1:-$HOME/Applications}"
NAME="Atelier Projets"
APP="$TARGET_DIR/$NAME.app"

NODE="$(command -v node || true)"
NPM="$(command -v npm || true)"
if [[ -z "$NODE" || -z "$NPM" ]]; then
  echo "✘ node ou npm introuvable dans ce terminal : installer Node.js 24 puis relancer." >&2
  exit 1
fi
cd "$REPO"
if [[ ! -d node_modules/electron ]]; then
  echo "→ Installation des dépendances (npm install)…"
  npm install --no-audit --no-fund
fi

echo "→ Téléchargement d'Electron si besoin…"
node -e "require('electron')" >/dev/null
ELECTRON_APP="$REPO/node_modules/electron/dist/Electron.app"
if [[ ! -d "$ELECTRON_APP" ]]; then
  echo "✘ Electron introuvable ($ELECTRON_APP). Essayer : rm -rf node_modules/electron && npm install" >&2
  exit 1
fi

echo "→ Préparation de l'application (base, compilation)…"
node desktop/prepare.cjs

# PATH enregistré sans les dossiers ajoutés par npm pour ce script (node_modules/.bin, node-gyp-bin) :
# une application ouverte depuis le Finder ne charge pas ~/.zshrc.
SAVED_PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v -e '/node_modules/\.bin$' -e 'node-gyp-bin' | paste -sd: -)"

echo "→ Création de $APP…"
# Ancienne application (lanceur navigateur ou version précédente) : arrêtée puis remplacée.
osascript -e "if application \"$NAME\" is running then tell application \"$NAME\" to quit" >/dev/null 2>&1 || true
sleep 1
mkdir -p "$TARGET_DIR"
rm -rf "$APP"
ditto "$ELECTRON_APP" "$APP"

PLIST="$APP/Contents/Info.plist"
plutil -replace CFBundleName -string "$NAME" "$PLIST"
plutil -replace CFBundleDisplayName -string "$NAME" "$PLIST"
plutil -replace CFBundleIdentifier -string "local.atelier-projets.desktop" "$PLIST"
plutil -replace CFBundleIconFile -string "AppIcon" "$PLIST"
plutil -replace NSHumanReadableCopyright -string "Atelier Projets — application locale" "$PLIST"

# Lanceur : le code de l'application est lu dans le dépôt.
RESOURCES="$APP/Contents/Resources"
rm -f "$RESOURCES/default_app.asar"
mkdir -p "$RESOURCES/app"
ATELIER_REPO="$REPO" ATELIER_PATH="$SAVED_PATH" ATELIER_OUT="$RESOURCES/app" node <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const { version } = require(path.join(process.env.ATELIER_REPO, 'desktop', 'package.json'))
const out = process.env.ATELIER_OUT
fs.writeFileSync(
  path.join(out, 'package.json'),
  `${JSON.stringify({ name: 'atelier-projets', productName: 'Atelier Projets', version, main: 'main.cjs', private: true }, null, 2)}\n`,
)
fs.writeFileSync(
  path.join(out, 'main.cjs'),
  `// Lanceur généré par scripts/macos/install-desktop.sh (ne pas modifier : relancer « npm run app:install »).
'use strict'
process.env.ATELIER_REPO = ${JSON.stringify(process.env.ATELIER_REPO)}
process.env.PATH = ${JSON.stringify(process.env.ATELIER_PATH)}
const fs = require('node:fs')
const path = require('node:path')
const entry = path.join(process.env.ATELIER_REPO, 'desktop', 'main.cjs')
if (fs.existsSync(entry)) {
  require(entry)
} else {
  const { app, dialog } = require('electron')
  app.whenReady().then(() => {
    dialog.showErrorBox('Atelier Projets', 'Dépôt introuvable : ' + process.env.ATELIER_REPO + '\\n\\nDepuis le dépôt (déplacé ?), relancer : npm run app:install')
    app.quit()
  })
}
`,
)
NODE

# Icône : fusée en PNG convertie en .icns avec les outils de macOS (sips, iconutil).
ICON_SRC="$REPO/scripts/macos/AppIcon.png"
if [[ -f "$ICON_SRC" ]] && command -v iconutil >/dev/null 2>&1; then
  ICONSET="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    sips -z $((size * 2)) $((size * 2)) "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$RESOURCES/AppIcon.icns" && rm -rf "$(dirname "$ICONSET")"
fi

# Info.plist et contenu modifiés : nouvelle signature locale (« ad hoc »), exigée sur les Mac Apple Silicon.
xattr -cr "$APP" 2>/dev/null || true
if ! codesign --force --deep --sign - "$APP" >/dev/null 2>&1; then
  echo "⚠ Signature locale impossible (codesign) : si macOS refuse d'ouvrir l'application, clic droit → Ouvrir." >&2
fi
touch "$APP"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[[ -x "$LSREGISTER" ]] && "$LSREGISTER" -f "$APP" >/dev/null 2>&1 || true

echo "✔ Application créée : $APP"
echo "  Dépôt    : $REPO"
echo "  Node     : $NODE ($("$NODE" --version))"
echo "  Electron : $(node -p "require('./node_modules/electron/package.json').version")"
echo "  Double-cliquer dessus dans le Finder, ou la glisser dans le Dock."
