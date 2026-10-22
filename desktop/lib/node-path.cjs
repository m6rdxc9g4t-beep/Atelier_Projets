// Node.js et npm pour une application ouverte depuis le Finder (docs/SUITE.md §8) : macOS ne lui donne qu'un PATH
// minimal (/usr/bin:/bin…), sans Homebrew ni nvm. On cherche, dans l'ordre : le PATH du shell de connexion zsh
// (celui du terminal de l'utilisateur, où les dépendances ont été installées), le PATH enregistré par le lanceur,
// Homebrew (~/.homebrew/bin, /opt/homebrew/bin, /usr/local/bin), puis nvm (version par défaut, puis la plus récente).
// Le premier dossier qui contient node et npm, avec un Node accepté par le dépôt (^22.12 ou >= 24), est placé en
// tête du PATH donné à npm et à l'API.
'use strict'

const { execFile, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const MARK = '__ATELIER_PATH__'
const SYSTEM_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin']

/** Dossier acceptable dans un PATH : absolu, sans node_modules/.bin (un dépôt ne doit pas fournir « node »). */
function usableDir(dir) {
  return typeof dir === 'string' && path.isAbsolute(dir) && !/node_modules[\\/]\.bin\/?$/.test(dir)
}

function splitPath(value) {
  return (value ?? '').split(path.delimiter).filter(usableDir)
}

/**
 * PATH du shell de connexion interactif (zsh -l -i : ~/.zprofile pour Homebrew, ~/.zshrc pour nvm), ou null.
 * Entrée fermée, délai court : un ~/.zshrc qui pose une question ou se bloque ne retient pas l'application.
 */
function loginShellPath({ shell = fs.existsSync('/bin/zsh') ? '/bin/zsh' : process.env.SHELL, timeoutMs = 5000, spawnShell = spawn } = {}) {
  if (!shell || !/(^|\/)(zsh|bash)$/.test(shell)) return Promise.resolve(null)
  return new Promise((resolve) => {
    let stdout = ''
    let child
    try {
      child = spawnShell(shell, ['-l', '-i', '-c', `printf '\\n${MARK}%s${MARK}\\n' "$PATH"`], {
        env: { ...process.env, TERM: 'dumb' },
        stdio: ['ignore', 'pipe', 'ignore'],
        detached: process.platform !== 'win32', // groupe à part : tout le shell est arrêté au délai
      })
    } catch {
      return resolve(null)
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.once('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.once('close', () => {
      clearTimeout(timer)
      const match = new RegExp(`${MARK}(.*?)${MARK}`).exec(stdout)
      resolve(match ? match[1] : null)
    })
  })
}

function versionKey(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version)
  return match ? match.slice(1).map(Number) : null
}

function compareVersions(a, b) {
  const [x, y] = [versionKey(a), versionKey(b)]
  for (let i = 0; i < 3; i += 1) if ((x?.[i] ?? -1) !== (y?.[i] ?? -1)) return (x?.[i] ?? -1) - (y?.[i] ?? -1)
  return 0
}

/** Dossiers bin de nvm : version de l'alias « default » d'abord (24, 24.1, v24.1.0, node), puis de la plus récente à la plus ancienne. */
function nvmDirs({ nvmDir, readdir = fs.readdirSync, readFile = fs.readFileSync }) {
  let versions = []
  try {
    versions = readdir(path.join(nvmDir, 'versions', 'node')).filter((name) => versionKey(name))
  } catch {
    return []
  }
  versions.sort((a, b) => compareVersions(b, a))
  let alias = ''
  try {
    alias = String(readFile(path.join(nvmDir, 'alias', 'default'), 'utf8')).trim().replace(/^v/, '')
  } catch {
    /* pas d'alias */
  }
  const preferred =
    alias === 'node' || alias === 'stable'
      ? versions[0]
      : /^\d+(\.\d+){0,2}$/.test(alias)
        ? versions.find((version) => `${version.replace(/^v/, '')}.`.startsWith(`${alias}.`))
        : undefined
  const ordered = preferred ? [preferred, ...versions.filter((version) => version !== preferred)] : versions
  return ordered.map((version) => path.join(nvmDir, 'versions', 'node', version, 'bin'))
}

/** Dossiers candidats, dans l'ordre de préférence, sans doublon. */
function candidateDirs({ shellPath = null, currentPath = process.env.PATH, home = os.homedir(), nvmDir, readdir, readFile } = {}) {
  const dirs = [
    ...splitPath(shellPath),
    ...splitPath(currentPath),
    path.join(home, '.homebrew', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    ...nvmDirs({ nvmDir: nvmDir ?? path.join(home, '.nvm'), readdir, readFile }),
  ]
  return [...new Set(dirs)]
}

/** Node accepté par le dépôt (package.json « engines » : ^22.12.0 || >=24.0.0). */
function supportedNode(version) {
  const key = versionKey(version)
  if (!key) return false
  const [major, minor] = key
  return (major === 22 && minor >= 12) || major >= 24
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function nodeVersion(node, run = execFile) {
  return new Promise((resolve) => {
    run(node, ['--version'], { timeout: 5000, encoding: 'utf8' }, (error, stdout) => resolve(error ? null : String(stdout).trim()))
  })
}

/**
 * Trouve node et npm. Renvoie { dir, version, path } — path : PATH à utiliser, dossier choisi en tête —
 * ou null si aucun dossier ne contient les deux. Un Node trop ancien n'est retenu qu'à défaut d'un autre
 * (supported: false, signalé au journal).
 */
async function findNode(options = {}) {
  const { executable = isExecutable, version = nodeVersion } = options
  const shellPath = options.shellPath !== undefined ? options.shellPath : await loginShellPath(options)
  const dirs = candidateDirs({ ...options, shellPath })
  let fallback = null
  for (const dir of dirs) {
    if (!executable(path.join(dir, 'node')) || !executable(path.join(dir, 'npm'))) continue
    const found = await version(path.join(dir, 'node'))
    if (!found) continue
    const result = { dir, version: found, supported: supportedNode(found) }
    if (result.supported) {
      fallback = result
      break
    }
    fallback ??= result
  }
  if (!fallback) return null
  const rest = [...splitPath(shellPath), ...splitPath(options.currentPath ?? process.env.PATH), ...SYSTEM_DIRS]
  return { ...fallback, path: [...new Set([fallback.dir, ...rest])].join(path.delimiter) }
}

module.exports = { findNode, candidateDirs, nvmDirs, loginShellPath, supportedNode, usableDir }
