// Emplacements de l'application de bureau par système (docs/SUITE.md §9.2) — une seule fonction par usage, testée
// (test/environment.test.cjs). macOS inchangé ; Windows : %LOCALAPPDATA% (journaux) et %APPDATA% (données propres à
// l'app). La base reste dans le dépôt (backend/prisma/dev.db, ignorée par git) sur tous les systèmes.
'use strict'

const os = require('node:os')
const path = require('node:path')

/** Nom technique de l'app dans les dossiers du système (mêmes noms que sur macOS). */
const APP_DIR = 'Atelier_Projets'

/**
 * Dossier des journaux (app.log, mise-a-jour.log) : ATELIER_LOG_DIR s'il est défini ; macOS ~/Library/Logs/Atelier_Projets ;
 * Windows %LOCALAPPDATA%\Atelier_Projets\Logs ; ailleurs null (l'appelant choisit : dossier de l'app Electron, temporaire).
 */
function logDirectory({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (env.ATELIER_LOG_DIR) return env.ATELIER_LOG_DIR
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Logs', APP_DIR)
  if (platform === 'win32') return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), APP_DIR, 'Logs')
  return null
}

/**
 * Données propres à l'app hors dépôt (taille de la fenêtre…) : Windows %APPDATA%\Atelier_Projets ; ailleurs null
 * (dossier par défaut d'Electron, inchangé sur macOS).
 */
function dataDirectory({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), APP_DIR)
  return null
}

module.exports = { APP_DIR, logDirectory, dataDirectory }
