// Environnement de l'application de bureau (docs/SUITE.md §9.4) — logique pure, testée sans Electron
// (test/environment.test.cjs).
//
// 1. Au lancement de l'app de bureau, les variables héritées qui désigneraient d'autres données ou une autre
//    configuration sont ignorées : la configuration de l'API vient de backend/.env ou des valeurs par défaut.
//    Cas réel : ouverte depuis Atelier Nexus, l'app héritait de DATABASE_URL=sqlite+aiosqlite:///…/nexus.db ;
//    « npm run db:deploy » (sauvegarde avant migration → loadConfig) la refusait et la mise à jour échouait.
// 2. Quand l'app en ouvre une autre de la suite, elle ne lui passe qu'un environnement minimal (liste blanche).
'use strict'

const path = require('node:path')

/**
 * Variables héritées ignorées par l'app de bureau (lues par backend/src/config.ts ou par les outils de compilation),
 * avec la raison. Les autres réglages du backend (OLLAMA_*, CLAUDE_*, GITHUB_*, APP_TIMEZONE…) sont des préférences
 * de l'utilisateur, propres à un outil, qui ne désignent pas des données : ils restent pris en compte.
 */
const IGNORED_INHERITED = Object.freeze({
  // Données : URL d'une autre base (Nexus : sqlite+aiosqlite:///…/nexus.db, PostgreSQL…). La base de l'app de bureau
  // est celle de backend/.env, sinon backend/prisma/dev.db (docs/SUITE.md §9.2).
  DATABASE_URL: 'désigne la base d’une autre application',
  // Adresse d'écoute de l'API : noms génériques (uvicorn, Next.js, Nexus…). Hérités, ils déplaceraient l'API sur le
  // port d'une autre app, ou l'exposeraient sur le réseau (HOST=0.0.0.0), et l'interface ne la trouverait plus.
  HOST: 'adresse d’écoute d’une autre application',
  PORT: 'port d’une autre application',
  // Politique de sécurité de l'API (en-têtes Host / Origin acceptés) : Atelier Viz utilise le même nom.
  ALLOWED_HOSTS: 'hôtes autorisés d’une autre application',
  // Secret de l'import Atelier Tab : celui d'un client (Tab, Nexus) changerait l'authentification de l'import.
  ATELIER_IMPORT_TOKEN: 'jeton d’une autre application',
  // Emplacement et nombre des sauvegardes de la base : données (BACKUP_KEEP=0 les désactiverait).
  BACKUP_DIR: 'dossier de sauvegarde d’une autre application',
  BACKUP_KEEP: 'réglage de sauvegarde d’une autre application',
  // Nom générique : une valeur Python (WARNING, CRITICAL) est refusée par loadConfig et l'API ne démarrerait plus.
  LOG_LEVEL: 'niveau de journal d’une autre application',
  // Mode d'exécution d'une autre app (NODE_ENV=development d'un serveur Next.js) : compilation Vite non optimisée.
  NODE_ENV: 'mode d’exécution d’une autre application',
})

/** Comparaison des noms : insensible à la casse sous Windows (Path, PATH…), exacte ailleurs. */
function sameName(platform) {
  return platform === 'win32' ? (a, b) => a.toUpperCase() === b.toUpperCase() : (a, b) => a === b
}

/**
 * Environnement de l'app de bureau : copie de `env` sans les variables de IGNORED_INHERITED.
 * Renvoie { env, ignored } — ignored : noms retirés (jamais leurs valeurs, qui peuvent être des secrets).
 */
function desktopEnvironment(env, { platform = process.platform } = {}) {
  const same = sameName(platform)
  const names = Object.keys(IGNORED_INHERITED)
  const clean = {}
  const ignored = []
  for (const [name, value] of Object.entries(env)) {
    const match = names.find((candidate) => same(candidate, name))
    if (match) ignored.push(name)
    else clean[name] = value
  }
  return { env: clean, ignored }
}

/**
 * Applique desktopEnvironment à process.env (en place : les modules déjà chargés le voient) ; renvoie les noms
 * retirés, pour le journal.
 */
function sanitizeProcessEnv(target = process.env, options = {}) {
  const { ignored } = desktopEnvironment(target, options)
  for (const name of ignored) delete target[name]
  return ignored
}

/** Message de journal (sans valeur) ; null si rien n'a été ignoré. */
function ignoredMessage(ignored) {
  if (ignored.length === 0) return null
  return `Variables héritées ignorées (configuration de backend/.env ou valeurs par défaut) : ${ignored.join(', ')}.`
}

// --- Environnement minimal transmis à une autre app de la suite --------------------------------------------------

/** Noms transmis tels quels (utilisateur, dossier personnel, langue, fuseau, dossiers temporaires et système). */
const MINIMAL_NAMES = Object.freeze([
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'USER',
  'USERNAME',
  'USERDOMAIN',
  'LOGNAME',
  'LANG',
  'LANGUAGE',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'ComSpec',
  'PATHEXT',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'CommonProgramFiles',
  'CommonProgramFiles(x86)',
  'CommonProgramW6432',
])

/** PATH système : dossiers du système d'exploitation seulement (macOS, Linux), ou de Windows. */
function systemPath(env, platform) {
  if (platform !== 'win32') return ['/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':')
  const root = env.SystemRoot || env.windir || env.SYSTEMROOT || 'C:\\Windows'
  const win = path.win32
  return [win.join(root, 'System32'), root, win.join(root, 'System32', 'Wbem'), win.join(root, 'System32', 'WindowsPowerShell', 'v1.0'), win.join(root, 'System32', 'OpenSSH')].join(';')
}

/**
 * Environnement minimal (liste blanche, docs/SUITE.md §9.4) pour ouvrir une autre app de la suite : aucune variable
 * de cette app (DATABASE_URL, PORT, ATELIER_*, ELECTRON_*, NODE_*…) ne passe. `PATH` : `pathValue` s'il est donné
 * (Windows : PATH de la session lu dans le registre), sinon le PATH système.
 */
function minimalEnvironment(env, { platform = process.platform, pathValue = null } = {}) {
  const same = sameName(platform)
  const out = {}
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue
    if (MINIMAL_NAMES.some((allowed) => same(allowed, name)) || /^LC_[A-Z]+$/.test(name)) out[name] = value
  }
  out[platform === 'win32' ? 'Path' : 'PATH'] = pathValue || systemPath(env, platform)
  return out
}

module.exports = { IGNORED_INHERITED, MINIMAL_NAMES, desktopEnvironment, sanitizeProcessEnv, ignoredMessage, minimalEnvironment, systemPath }
