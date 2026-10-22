// Node.js et npm pour une application ouverte depuis le Finder ou le menu Démarrer (docs/SUITE.md §8, §9.3).
//
// macOS / Linux : une application ouverte depuis le Finder n'a qu'un PATH minimal (/usr/bin:/bin…), sans Homebrew ni
// nvm. On cherche, dans l'ordre : le PATH du shell de connexion zsh (celui du terminal de l'utilisateur, où les
// dépendances ont été installées), le PATH enregistré par le lanceur, Homebrew (~/.homebrew/bin, /opt/homebrew/bin,
// /usr/local/bin), puis nvm (version par défaut, puis la plus récente).
//
// Windows : le PATH reçu (l'Explorateur donne au menu Démarrer le PATH complet de l'utilisateur, et c'est celui du
// terminal qui a lancé install.ps1), puis le PATH de la session lu dans le registre (machine puis utilisateur : l'app
// peut avoir été ouverte par une autre app avec un environnement minimal, §9.4), %ProgramFiles%\nodejs, nvm-windows
// (%NVM_SYMLINK%, puis les versions de %NVM_HOME%), Volta, fnm, %LOCALAPPDATA%\Programs\nodejs.
//
// Le premier dossier qui contient node et npm, avec un Node accepté par le dépôt (^22.12 ou >= 24), est placé en
// tête du PATH donné à npm et à l'API.
'use strict'

const { execFile, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const MARK = '__ATELIER_PATH__'
const SYSTEM_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin']

/** Module de chemins du système visé (les tests de la logique Windows tournent aussi sous macOS / Linux). */
function pathsFor(platform) {
  return platform === 'win32' ? path.win32 : path.posix
}

/** Dossier acceptable dans un PATH : absolu, sans node_modules/.bin (un dépôt ne doit pas fournir « node »). */
function usableDir(dir, platform = process.platform) {
  return typeof dir === 'string' && pathsFor(platform).isAbsolute(dir) && !/node_modules[\\/]\.bin[\\/]?$/.test(dir)
}

function splitPath(value, platform = process.platform) {
  const delimiter = platform === 'win32' ? ';' : ':'
  return (value ?? '')
    .split(delimiter)
    .map((dir) => (platform === 'win32' ? dir.trim().replace(/^"(.*)"$/, '$1') : dir))
    .filter((dir) => usableDir(dir, platform))
}

/** Valeur d'une variable d'environnement (nom insensible à la casse sous Windows : Path, PATH). */
function envValue(env, name, platform = process.platform) {
  if (platform !== 'win32') return env[name]
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase())
  return key === undefined ? undefined : env[key]
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

// --- Windows : PATH de la session lu dans le registre ------------------------------------------------------------

const REGISTRY_PATH_KEYS = Object.freeze([
  'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
  'HKCU\\Environment',
])

/** reg.exe du système, par chemin absolu (jamais cherché dans le PATH). */
function regExe(env = process.env) {
  return path.win32.join(envValue(env, 'SystemRoot', 'win32') || 'C:\\Windows', 'System32', 'reg.exe')
}

/** Valeur lue dans la sortie de « reg query <clé> /v <nom> » (REG_SZ ou REG_EXPAND_SZ), ou null. */
function parseRegValue(output, name) {
  for (const line of String(output).split(/\r?\n/)) {
    const match = /^\s+(.+?)\s+(REG_SZ|REG_EXPAND_SZ)\s+(.*)$/.exec(line)
    if (match && match[1].toUpperCase() === name.toUpperCase()) return match[3].trim()
  }
  return null
}

/** Remplace %NOM% par la variable d'environnement (insensible à la casse) ; une variable inconnue reste telle quelle. */
function expandWindowsVars(value, env) {
  return value.replace(/%([^%;]+)%/g, (whole, name) => envValue(env, name, 'win32') ?? whole)
}

/** Lit une valeur du registre par reg.exe (sans shell, fenêtre masquée) ; null si absente ou illisible. */
function readRegistryValue(key, name, { run = execFile, env = process.env, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    try {
      run(regExe(env), ['query', key, '/v', name], { timeout: timeoutMs, encoding: 'utf8', windowsHide: true }, (error, stdout) =>
        resolve(error ? null : parseRegValue(stdout, name)),
      )
    } catch {
      resolve(null)
    }
  })
}

/**
 * PATH de la session Windows (machine puis utilisateur, %VAR% développés) : celui qu'aurait l'app ouverte depuis le
 * menu Démarrer, même si elle a été lancée par une autre app avec un environnement minimal. null si illisible.
 */
async function windowsSessionPath({ run = execFile, env = process.env } = {}) {
  const parts = []
  for (const key of REGISTRY_PATH_KEYS) {
    const value = await readRegistryValue(key, 'Path', { run, env })
    if (value) parts.push(expandWindowsVars(value, env))
  }
  return parts.length > 0 ? parts.join(';') : null
}

// --- Dossiers candidats ------------------------------------------------------------------------------------------

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

/** nvm-windows : versions installées dans %NVM_HOME% (v24.1.0\node.exe), de la plus récente à la plus ancienne. */
function nvmWindowsDirs({ nvmHome, readdir = fs.readdirSync }) {
  if (!nvmHome) return []
  let versions = []
  try {
    versions = readdir(nvmHome).filter((name) => versionKey(name))
  } catch {
    return []
  }
  return versions.sort((a, b) => compareVersions(b, a)).map((version) => path.win32.join(nvmHome, version))
}

/** Dossiers Windows connus (§9.3), dans l'ordre, après le PATH. */
function windowsDirs({ env, home, readdir }) {
  const win = path.win32
  const get = (name) => envValue(env, name, 'win32')
  const programFiles = get('ProgramFiles') || 'C:\\Program Files'
  const localAppData = get('LOCALAPPDATA') || win.join(home, 'AppData', 'Local')
  const appData = get('APPDATA') || win.join(home, 'AppData', 'Roaming')
  const fnmDir = get('FNM_DIR') || win.join(appData, 'fnm')
  return [
    win.join(programFiles, 'nodejs'),
    ...(get('NVM_SYMLINK') ? [get('NVM_SYMLINK')] : []),
    ...nvmWindowsDirs({ nvmHome: get('NVM_HOME'), readdir }),
    win.join(localAppData, 'Volta', 'bin'),
    win.join(programFiles, 'Volta'),
    ...(get('FNM_MULTISHELL_PATH') ? [get('FNM_MULTISHELL_PATH')] : []),
    win.join(fnmDir, 'aliases', 'default'),
    win.join(localAppData, 'Programs', 'nodejs'),
  ]
}

/** Dossiers candidats, dans l'ordre de préférence, sans doublon. */
function candidateDirs({
  platform = process.platform,
  shellPath = null,
  env = process.env,
  currentPath = envValue(env, 'PATH', platform),
  home = os.homedir(),
  nvmDir,
  readdir,
  readFile,
} = {}) {
  const dirs =
    platform === 'win32'
      ? [...splitPath(currentPath, platform), ...splitPath(shellPath, platform), ...windowsDirs({ env, home, readdir })]
      : [
          ...splitPath(shellPath, platform),
          ...splitPath(currentPath, platform),
          path.join(home, '.homebrew', 'bin'),
          '/opt/homebrew/bin',
          '/usr/local/bin',
          ...nvmDirs({ nvmDir: nvmDir ?? path.join(home, '.nvm'), readdir, readFile }),
        ]
  // Windows : un même dossier peut s'écrire avec une autre casse ou un « \ » final.
  const key = platform === 'win32' ? (dir) => dir.replace(/[\\/]+$/, '').toLowerCase() : (dir) => dir
  const seen = new Set()
  return dirs.filter((dir) => !seen.has(key(dir)) && seen.add(key(dir)))
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
    run(node, ['--version'], { timeout: 5000, encoding: 'utf8', windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout).trim()))
  })
}

/** Exécutables de node et de npm dans un dossier, selon le système. */
function executables(platform) {
  return platform === 'win32' ? { node: ['node.exe'], npm: ['npm.cmd', 'npm.exe'] } : { node: ['node'], npm: ['npm'] }
}

/**
 * Commande qui lance npm, sans shell (docs/SUITE.md §9.3), sous forme [exécutable, ...arguments], ou null.
 * macOS / Linux : « npm » du PATH. Windows : depuis Node 20.12, un .cmd ne se lance plus sans shell ; on lance donc
 * node.exe avec le npm-cli.js installé à côté (installation officielle, nvm-windows, fnm), sinon npm.exe (Volta).
 * Jamais de chaîne de commande construite pour cmd.exe.
 */
function npmCommand({ platform = process.platform, pathValue, env = process.env, exists = fs.existsSync } = {}) {
  if (platform !== 'win32') return ['npm']
  const win = path.win32
  for (const dir of splitPath(pathValue ?? envValue(env, 'PATH', platform), platform)) {
    const node = win.join(dir, 'node.exe')
    const cli = win.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (exists(node) && exists(cli)) return [node, cli]
    const npmExe = win.join(dir, 'npm.exe')
    if (exists(npmExe)) return [npmExe]
  }
  return null
}

/** Dossiers ajoutés en fin de PATH sous Windows : système et Git for Windows (git sert à l'état du dépôt, §8.1). */
function windowsTailDirs(env, home) {
  const win = path.win32
  const root = envValue(env, 'SystemRoot', 'win32') || 'C:\\Windows'
  const programFiles = envValue(env, 'ProgramFiles', 'win32') || 'C:\\Program Files'
  const localAppData = envValue(env, 'LOCALAPPDATA', 'win32') || win.join(home, 'AppData', 'Local')
  return [
    win.join(root, 'System32'),
    root,
    win.join(root, 'System32', 'Wbem'),
    win.join(root, 'System32', 'WindowsPowerShell', 'v1.0'),
    win.join(programFiles, 'Git', 'cmd'),
    win.join(localAppData, 'Programs', 'Git', 'cmd'),
  ]
}

/**
 * Trouve node et npm. Renvoie { dir, version, path } — path : PATH à utiliser, dossier choisi en tête —
 * ou null si aucun dossier ne contient les deux. Un Node trop ancien n'est retenu qu'à défaut d'un autre
 * (supported: false, signalé au journal).
 */
async function findNode(options = {}) {
  const { platform = process.platform, env = process.env, home = os.homedir(), executable = platform === 'win32' ? (file) => fs.existsSync(file) : isExecutable, version = nodeVersion } = options
  let shellPath = options.shellPath
  if (shellPath === undefined) shellPath = platform === 'win32' ? await windowsSessionPath({ run: options.run, env }) : await loginShellPath(options)
  const currentPath = options.currentPath !== undefined ? options.currentPath : envValue(env, 'PATH', platform)
  const dirs = candidateDirs({ ...options, platform, env, home, shellPath, currentPath })
  const join = pathsFor(platform).join
  const names = executables(platform)
  let fallback = null
  for (const dir of dirs) {
    const node = names.node.map((name) => join(dir, name)).find((file) => executable(file))
    if (!node || !names.npm.some((name) => executable(join(dir, name)))) continue
    const found = await version(node)
    if (!found) continue
    const result = { dir, version: found, supported: supportedNode(found) }
    if (result.supported) {
      fallback = result
      break
    }
    fallback ??= result
  }
  if (!fallback) return null
  const paths = platform === 'win32' ? [currentPath, shellPath] : [shellPath, currentPath]
  const rest = [...paths.flatMap((value) => splitPath(value, platform)), ...(platform === 'win32' ? windowsTailDirs(env, home) : SYSTEM_DIRS)]
  const key = platform === 'win32' ? (dir) => dir.replace(/[\\/]+$/, '').toLowerCase() : (dir) => dir
  const seen = new Set()
  const ordered = [fallback.dir, ...rest].filter((dir) => !seen.has(key(dir)) && seen.add(key(dir)))
  return { ...fallback, path: ordered.join(platform === 'win32' ? ';' : ':') }
}

module.exports = {
  findNode,
  candidateDirs,
  nvmDirs,
  nvmWindowsDirs,
  loginShellPath,
  windowsSessionPath,
  parseRegValue,
  expandWindowsVars,
  readRegistryValue,
  regExe,
  npmCommand,
  envValue,
  supportedNode,
  usableDir,
}
