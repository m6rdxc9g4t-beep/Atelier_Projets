// Suite Atelier (docs/SUITE.md §3, §9.4) : une adresse d'une autre app de la suite (locale : hôte de bouclage et port ;
// en ligne : Atelier Cuisine, https et hôte exact) ouvre l'application installée ; sinon, ou en cas d'échec, l'adresse
// part dans le navigateur.
// - macOS : `/usr/bin/open -b <identifiant>` ;
// - Windows : lanceur enregistré dans HKCU\Software\Atelier\Apps\<viz|tab|projets|nexus> (valeur « Lanceur »), lu par
//   reg.exe (sans shell) et démarré directement (.exe), par wscript.exe (.vbs) ou par l'Explorateur (.lnk).
// L'app ouverte ne reçoit qu'un environnement minimal (lib/environment.cjs) : aucune variable de celle-ci
// (DATABASE_URL, PORT, ATELIER_*, ELECTRON_*…) ne lui passe.
// Logique pure, dépendances injectables : testée sans Electron (test/suite-launch.test.cjs).
'use strict'

const { execFile: nodeExecFile, spawn: nodeSpawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { minimalEnvironment } = require('./environment.cjs')
const { envValue, readRegistryValue, windowsSessionPath } = require('./node-path.cjs')

/** Apps de bureau, par port de leur interface (liste fermée) : identifiant macOS et clé du registre Windows. */
const SUITE_APPS = Object.freeze({
  8000: Object.freeze({ bundle: 'fr.atelier-viz.app', key: 'viz' }),
  4175: Object.freeze({ bundle: 'fr.atelier.tab', key: 'tab' }),
  4174: Object.freeze({ bundle: 'local.atelier-projets.desktop', key: 'projets' }),
})

/** Identifiants des apps de bureau, par port de leur interface (liste fermée). */
const SUITE_BUNDLES = Object.freeze(Object.fromEntries(Object.entries(SUITE_APPS).map(([port, app]) => [port, app.bundle])))

/** Apps en ligne de la suite : hôte exact (https, port par défaut) → identifiant (liste fermée ; app Mac seulement). */
const SUITE_ONLINE_BUNDLES = Object.freeze({
  'atelier-cuisine-iota.vercel.app': 'fr.ateliercuisine.app',
})

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

/** Clé du registre où chaque app installée sous Windows s'enregistre (docs/SUITE.md §9.4). */
const REGISTRY_ROOT = 'HKCU\\Software\\Atelier\\Apps'

/** App de la suite désignée par une adresse : { bundle, key? } (key : app de bureau Windows), sinon null. */
function suiteAppFor(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.username !== '' || parsed.password !== '') return null
  if (parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname)) return Object.hasOwn(SUITE_APPS, parsed.port) ? SUITE_APPS[parsed.port] : null
  // App en ligne : https seulement, port par défaut, hôte exact.
  if (parsed.protocol !== 'https:' || parsed.port !== '') return null
  return Object.hasOwn(SUITE_ONLINE_BUNDLES, parsed.hostname) ? { bundle: SUITE_ONLINE_BUNDLES[parsed.hostname] } : null
}

/** Identifiant de l'app de bureau (macOS) pour une adresse de la suite, sinon null. */
function suiteBundleFor(url) {
  return suiteAppFor(url)?.bundle ?? null
}

/**
 * Commande qui démarre un lanceur Windows enregistré, sans shell : [exécutable, ...arguments], ou null si le lanceur
 * n'est pas un chemin absolu d'un type connu (.exe direct, .vbs par wscript.exe, .lnk par l'Explorateur).
 */
function windowsLaunchCommand(launcher, env) {
  if (typeof launcher !== 'string' || !path.win32.isAbsolute(launcher) || /^\\\\/.test(launcher)) return null
  const root = envValue(env, 'SystemRoot', 'win32') || 'C:\\Windows'
  const extension = path.win32.extname(launcher).toLowerCase()
  if (extension === '.exe') return [launcher]
  if (extension === '.vbs') return [path.win32.join(root, 'System32', 'wscript.exe'), launcher]
  if (extension === '.lnk') return [path.win32.join(root, 'explorer.exe'), launcher]
  return null
}

/** Démarre un processus détaché ; résout true s'il a démarré, false sinon (fichier absent, refusé). */
function startDetached(spawn, command, env) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command[0], command.slice(1), { env, cwd: path.win32.dirname(command[command.length - 1]), detached: true, stdio: 'ignore', windowsHide: false })
    } catch {
      return resolve(false)
    }
    child.once('error', () => resolve(false))
    child.once('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}

async function openOnWindows(app, deps) {
  const { env = process.env, spawn = nodeSpawn, exists = fs.existsSync, readRegistry = (key, name) => readRegistryValue(key, name, { env }), sessionPath = () => windowsSessionPath({ env }) } = deps
  if (!app.key) return false
  const launcher = await readRegistry(`${REGISTRY_ROOT}\\${app.key}`, 'Lanceur')
  const command = windowsLaunchCommand(launcher, env)
  if (!command || !exists(launcher)) return false
  const childEnv = minimalEnvironment(env, { platform: 'win32', pathValue: await sessionPath() })
  return startDetached(spawn, command, childEnv)
}

function openOnMac(bundle, { execFile = nodeExecFile, env = process.env }) {
  return new Promise((resolve) => {
    execFile('/usr/bin/open', ['-b', bundle], { env: minimalEnvironment(env, { platform: 'darwin' }) }, (error) => resolve(!error))
  })
}

/**
 * Ouvre une adresse externe : l'app de bureau de la suite si elle est reconnue et installée (macOS, Windows),
 * le navigateur par défaut sinon. Renvoie 'app' ou 'browser'.
 */
async function openSuiteOrExternal(url, deps) {
  const { openExternal, platform = process.platform } = deps
  const app = suiteAppFor(url)
  let opened = false
  if (app && platform === 'darwin') opened = await openOnMac(app.bundle, deps)
  else if (app && platform === 'win32') opened = await openOnWindows(app, deps).catch(() => false)
  if (opened) return 'app'
  const browser = Promise.resolve(openExternal(url))
  // Adresse hors suite : l'échec remonte (journalisé par l'appelant) ; repli après une app introuvable : silencieux.
  await (app ? browser.catch(() => undefined) : browser)
  return 'browser'
}

module.exports = { SUITE_APPS, SUITE_BUNDLES, SUITE_ONLINE_BUNDLES, REGISTRY_ROOT, suiteAppFor, suiteBundleFor, windowsLaunchCommand, openSuiteOrExternal }
