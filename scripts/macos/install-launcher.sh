#!/bin/bash
# Atelier_Projets — crée l'application macOS « Atelier Projets.app » (lancement en double clic).
#
#   npm run app:install            → ~/Applications/Atelier Projets.app
#   npm run app:install -- <dossier> → dans un autre dossier (ex. ~/Desktop)
#
# Au double clic, l'application :
#   - démarre l'API et l'interface (npm run dev) en arrière-plan si elles ne tournent pas, puis ouvre
#     http://127.0.0.1:5173 dans le navigateur par défaut ;
#   - si elles tournent déjà, propose « Ouvrir » ou « Arrêter ».
# Journal : ~/Library/Logs/Atelier_Projets/dev.log
#
# Le PATH du terminal qui lance ce script (Node, npm, git, claude…) est enregistré dans l'application :
# une application ouverte depuis le Finder ne charge pas ~/.zshrc. Relancer ce script après un changement
# d'installation de Node (nvm, Homebrew, conda…) ou un déplacement du dépôt.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "✘ Ce script crée une application macOS : à lancer sur le Mac." >&2
  exit 1
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
TARGET_DIR="${1:-$HOME/Applications}"
APP="$TARGET_DIR/Atelier Projets.app"

NODE="$(command -v node || true)"
NPM="$(command -v npm || true)"
if [[ -z "$NODE" || -z "$NPM" ]]; then
  echo "✘ node ou npm introuvable dans ce terminal : installer Node.js 24 puis relancer." >&2
  exit 1
fi
if [[ ! -d "$REPO/node_modules" ]]; then
  echo "✘ Dépendances absentes : lancer d'abord « npm install » dans $REPO" >&2
  exit 1
fi

# PATH enregistré sans les dossiers ajoutés par npm pour ce script (node_modules/.bin, node-gyp-bin).
SAVED_PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v -e '/node_modules/\.bin$' -e 'node-gyp-bin' | paste -sd: -)"

# Apostrophes pour le shell : 'l'\''atelier'
quote() { printf "'%s'" "${1//\'/\'\\\'\'}"; }

mkdir -p "$TARGET_DIR"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Atelier Projets</string>
  <key>CFBundleDisplayName</key><string>Atelier Projets</string>
  <key>CFBundleIdentifier</key><string>local.atelier-projets.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

{
  echo '#!/bin/bash'
  echo '# Atelier Projets — lanceur généré par scripts/macos/install-launcher.sh (ne pas modifier : relancer le script).'
  echo "REPO=$(quote "$REPO")"
  echo "export PATH=$(quote "$SAVED_PATH")"
  cat <<'LAUNCHER'
URL='http://127.0.0.1:5173'
API='http://127.0.0.1:3000/api/health'
LOG_DIR="$HOME/Library/Logs/Atelier_Projets"
LOG="$LOG_DIR/dev.log"
PID_FILE="$LOG_DIR/dev.pid"
mkdir -p "$LOG_DIR"

notify() { osascript -e "display notification \"$1\" with title \"Atelier Projets\"" >/dev/null 2>&1 || true; }
alert() { osascript -e "display alert \"Atelier Projets\" message \"$1\" as critical" >/dev/null 2>&1 || true; }
up() { curl -fsS -m 2 "$1" >/dev/null 2>&1; }

stop_app() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE")"
    # Groupe de processus complet : npm, concurrently, tsx (API) et Vite (interface).
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
  # Serveurs lancés à la main dans un terminal : on ne les arrête pas, on le signale.
  sleep 1
  if up "$API" || up "$URL"; then
    alert "L’application tourne aussi dans un terminal (npm run dev) : l’arrêter avec Ctrl+C dans ce terminal."
  else
    notify "Atelier Projets est arrêté."
  fi
}

if up "$API" && up "$URL"; then
  choice="$(osascript -e 'button returned of (display dialog "Atelier Projets est déjà lancé." buttons {"Arrêter", "Ouvrir"} default button "Ouvrir" with title "Atelier Projets")' 2>/dev/null || echo Annuler)"
  case "$choice" in
    Ouvrir) open "$URL" ;;
    Arrêter) stop_app ;;
  esac
  exit 0
fi

if [[ ! -d "$REPO" ]]; then
  alert "Dépôt introuvable : $REPO. Relancer « npm run app:install » depuis le dépôt."
  exit 1
fi

notify "Démarrage de l’API et de l’interface…"
cd "$REPO" || exit 1
printf '\n===== %s : démarrage =====\n' "$(date '+%d/%m/%Y %H:%M:%S')" >>"$LOG"
set -m   # processus en arrière-plan dans leur propre groupe : « Arrêter » les arrête tous
nohup npm run dev >>"$LOG" 2>&1 < /dev/null &
echo $! >"$PID_FILE"
set +m

for _ in $(seq 1 90); do
  if up "$API" && up "$URL"; then
    open "$URL"
    notify "Atelier Projets est prêt sur $URL"
    exit 0
  fi
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then break; fi
  sleep 1
done

alert "Le démarrage a échoué ou dépasse 90 s. Journal : $LOG"
open -a Console "$LOG" 2>/dev/null || open "$LOG_DIR"
exit 1
LAUNCHER
} > "$APP/Contents/MacOS/launcher"
chmod 755 "$APP/Contents/MacOS/launcher"

# Icône : fusée dessinée en PNG puis convertie en .icns avec les outils de macOS (sips, iconutil).
ICON_SRC="$REPO/scripts/macos/AppIcon.png"
if [[ -f "$ICON_SRC" ]] && command -v iconutil >/dev/null 2>&1; then
  ICONSET="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    sips -z $((size * 2)) $((size * 2)) "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns" && rm -rf "$(dirname "$ICONSET")"
fi
touch "$APP"

echo "✔ Application créée : $APP"
echo "  Dépôt : $REPO"
echo "  Node  : $NODE ($("$NODE" --version))"
echo "  Double-cliquer dessus dans le Finder, ou la glisser dans le Dock."
