// Node.js et npm pour l'application ouverte depuis le Finder ou le menu Démarrer (docs/SUITE.md §8, §9.3) : ordre de
// recherche (macOS : PATH du shell de connexion, PATH du lanceur, Homebrew, nvm ; Windows : PATH de la session lu dans
// le registre, PATH reçu, dossiers connus), version acceptée par le dépôt, commande npm sans shell. Faux node / npm ;
// la logique Windows est testée sur tous les systèmes (chemins et registre simulés).
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { after, before, describe, it } = require('node:test')
const {
  candidateDirs,
  expandWindowsVars,
  findNode,
  loginShellPath,
  npmCommand,
  nvmDirs,
  parseRegValue,
  supportedNode,
  usableDir,
  windowsSessionPath,
} = require('../lib/node-path.cjs')

// Faux node / npm en scripts shell : macOS et Linux seulement (la logique Windows a ses propres tests ci-dessous).
const posixOnly = { skip: process.platform === 'win32' ? 'scripts shell : macOS / Linux' : false }

let root
let home

/** Dossier bin avec un faux node (qui affiche `version`) et, si demandé, un faux npm. */
function fakeBin(dir, version, { npm = true } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'node'), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 })
  if (npm) fs.writeFileSync(path.join(dir, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  return dir
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-node-path-'))
  home = path.join(root, 'home')
  for (const version of ['v20.11.0', 'v22.12.0', 'v24.1.0', 'v24.10.2']) fakeBin(path.join(home, '.nvm', 'versions', 'node', version, 'bin'), version)
  fs.mkdirSync(path.join(home, '.nvm', 'alias'), { recursive: true })
})

after(() => fs.rmSync(root, { recursive: true, force: true }))

describe('recherche de Node.js', posixOnly, () => {
  it('accepte les versions du dépôt (^22.12 ou >= 24)', () => {
    assert.deepEqual(
      ['v22.11.0', 'v22.12.0', 'v23.5.0', 'v24.0.0', 'v26.1.0', 'v20.0.0', 'n/a'].map(supportedNode),
      [false, true, false, true, true, false, false],
    )
  })

  it('ignore les entrées relatives et node_modules/.bin du PATH', () => {
    assert.equal(usableDir('bin'), false)
    assert.equal(usableDir('/depot/node_modules/.bin'), false)
    assert.equal(usableDir('/opt/homebrew/bin'), true)
  })

  it('ordre : shell de connexion, PATH du lanceur, Homebrew de l’utilisateur, /opt/homebrew, /usr/local, nvm', () => {
    fs.writeFileSync(path.join(home, '.nvm', 'alias', 'default'), '22\n')
    const dirs = candidateDirs({ shellPath: '/shell/bin:./relatif:/usr/bin', currentPath: '/lanceur/bin:/usr/bin:/depot/node_modules/.bin', home })
    const nvm = (version) => path.join(home, '.nvm', 'versions', 'node', version, 'bin')
    assert.deepEqual(dirs, [
      '/shell/bin',
      '/usr/bin',
      '/lanceur/bin',
      path.join(home, '.homebrew', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      nvm('v22.12.0'),
      nvm('v24.10.2'),
      nvm('v24.1.0'),
      nvm('v20.11.0'),
    ])
  })

  it('nvm : alias par défaut (majeure, version exacte, node), sinon la plus récente', () => {
    const nvmDir = path.join(home, '.nvm')
    const first = () => path.basename(path.dirname(nvmDirs({ nvmDir })[0]))
    fs.writeFileSync(path.join(nvmDir, 'alias', 'default'), '24.1')
    assert.equal(first(), 'v24.1.0')
    fs.writeFileSync(path.join(nvmDir, 'alias', 'default'), 'v22.12.0')
    assert.equal(first(), 'v22.12.0')
    fs.writeFileSync(path.join(nvmDir, 'alias', 'default'), 'node')
    assert.equal(first(), 'v24.10.2')
    fs.writeFileSync(path.join(nvmDir, 'alias', 'default'), 'lts/*')
    assert.equal(first(), 'v24.10.2')
    assert.deepEqual(nvmDirs({ nvmDir: path.join(root, 'sans-nvm') }), [])
  })

  it('prend le premier dossier avec node et npm dans une version acceptée, placé en tête du PATH', async () => {
    const shellBin = fakeBin(path.join(root, 'shell-bin'), 'v20.5.0') // trop ancien
    const onlyNode = fakeBin(path.join(root, 'sans-npm'), 'v24.2.0', { npm: false })
    const brew = fakeBin(path.join(home, '.homebrew', 'bin'), 'v24.3.0')
    fs.writeFileSync(path.join(home, '.nvm', 'alias', 'default'), '22')
    const found = await findNode({ shellPath: `${shellBin}:${onlyNode}`, currentPath: '', home })
    assert.equal(found.dir, brew)
    assert.equal(found.version, 'v24.3.0')
    assert.equal(found.supported, true)
    assert.deepEqual(found.path.split(path.delimiter).slice(0, 4), [brew, shellBin, onlyNode, '/usr/bin'])
    assert.ok(found.path.split(path.delimiter).includes('/bin'))
    fs.rmSync(path.join(home, '.homebrew'), { recursive: true })
  })

  it('à défaut, garde un Node trop ancien (signalé) ; null si rien n’est trouvé', async () => {
    const old = fakeBin(path.join(root, 'ancien'), 'v20.5.0')
    const found = await findNode({ shellPath: old, currentPath: '', home: path.join(root, 'personne'), executable: (file) => file.startsWith(old) })
    assert.deepEqual({ dir: found.dir, supported: found.supported }, { dir: old, supported: false })
    assert.equal(await findNode({ shellPath: null, currentPath: '', home: path.join(root, 'personne'), executable: () => false }), null)
  })

  it('lit le PATH du shell de connexion entre deux marqueurs, malgré le bruit des fichiers de démarrage', async (t) => {
    if (!fs.existsSync('/bin/sh')) return t.skip('pas de /bin/sh')
    const shell = path.join(root, 'zsh')
    // Faux zsh : affiche du bruit (comme un ~/.zshrc bavard), puis exécute la commande demandée avec un PATH connu.
    fs.writeFileSync(shell, '#!/bin/sh\necho "Bienvenue !"\nPATH=/shell/bin:/usr/bin\nexport PATH\nshift 3\nexec /bin/sh -c "$1"\n', { mode: 0o755 })
    assert.equal(await loginShellPath({ shell }), '/shell/bin:/usr/bin')
    assert.equal(await loginShellPath({ shell: '/usr/bin/fish' }), null)
    // Un shell bloqué ne retient pas l'application.
    const stuck = path.join(root, 'bash')
    fs.writeFileSync(stuck, '#!/bin/sh\nsleep 5\n', { mode: 0o755 })
    const started = Date.now()
    assert.equal(await loginShellPath({ shell: stuck, timeoutMs: 200 }), null)
    assert.ok(Date.now() - started < 2000)
  })
})

describe('recherche de Node.js sous Windows (§9.3)', () => {
  const win = path.win32
  const env = {
    USERPROFILE: 'C:\\Users\\François',
    LOCALAPPDATA: 'C:\\Users\\François\\AppData\\Local',
    APPDATA: 'C:\\Users\\François\\AppData\\Roaming',
    ProgramFiles: 'C:\\Program Files',
    SystemRoot: 'C:\\WINDOWS',
    NVM_SYMLINK: 'C:\\nvm4w\\nodejs',
    NVM_HOME: 'C:\\Users\\François\\AppData\\Local\\nvm',
  }
  const home = 'C:\\Users\\François'
  const readdir = (dir) => {
    if (dir === env.NVM_HOME) return ['v20.11.0', 'v24.10.2', 'v22.12.0', 'settings.txt']
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  }

  it('ordre : PATH reçu, PATH de la session (registre), Program Files, nvm-windows, Volta, fnm, Programs\\nodejs', () => {
    const dirs = candidateDirs({
      platform: 'win32',
      env,
      home,
      readdir,
      shellPath: 'C:\\WINDOWS\\system32;"C:\\Program Files\\nodejs\\";relatif;C:\\depot\\node_modules\\.bin',
      currentPath: 'C:\\WINDOWS\\System32;C:\\Outils',
    })
    assert.deepEqual(dirs, [
      'C:\\WINDOWS\\System32',
      'C:\\Outils',
      'C:\\Program Files\\nodejs\\',
      'C:\\nvm4w\\nodejs',
      win.join(env.NVM_HOME, 'v24.10.2'),
      win.join(env.NVM_HOME, 'v22.12.0'),
      win.join(env.NVM_HOME, 'v20.11.0'),
      'C:\\Users\\François\\AppData\\Local\\Volta\\bin',
      'C:\\Program Files\\Volta',
      'C:\\Users\\François\\AppData\\Roaming\\fnm\\aliases\\default',
      'C:\\Users\\François\\AppData\\Local\\Programs\\nodejs',
    ])
  })

  it('trouve node.exe + npm.cmd, PATH en « ; » avec le dossier choisi en tête, puis Windows et Git', async () => {
    const files = new Set(['C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files\\nodejs\\npm.cmd', 'C:\\Outils\\node.exe'])
    const found = await findNode({
      platform: 'win32',
      env,
      home,
      readdir,
      shellPath: 'C:\\Outils',
      currentPath: '',
      executable: (file) => files.has(file),
      version: async () => 'v24.11.0',
    })
    assert.equal(found.dir, 'C:\\Program Files\\nodejs')
    const parts = found.path.split(';')
    assert.deepEqual(parts.slice(0, 3), ['C:\\Program Files\\nodejs', 'C:\\Outils', 'C:\\WINDOWS\\System32'])
    // Le PATH reçu passe avant celui du registre (terminal d'installation, menu Démarrer).
    const first = await findNode({
      platform: 'win32',
      env,
      home,
      readdir,
      shellPath: 'C:\\Program Files\\nodejs',
      currentPath: 'C:\\hostedtoolcache\\node\\24\\x64',
      executable: (file) => /\\(node\.exe|npm\.cmd)$/.test(file),
      version: async () => 'v24.11.0',
    })
    assert.equal(first.dir, 'C:\\hostedtoolcache\\node\\24\\x64')
    assert.ok(parts.includes('C:\\Program Files\\Git\\cmd'))
  })

  it('PATH de la session : registre machine puis utilisateur, %VAR% développés, reg.exe par chemin absolu sans shell', async () => {
    const calls = []
    const run = (file, args, options, done) => {
      calls.push({ file, args, windowsHide: options.windowsHide, shell: options.shell })
      const machine = args[1].startsWith('HKLM')
      done(null, `\r\n${args[1]}\r\n    Path    ${machine ? 'REG_EXPAND_SZ    %SystemRoot%\\system32;%ProgramFiles%\\nodejs\\' : 'REG_SZ    %USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;%INCONNUE%\\bin'}\r\n\r\n`)
    }
    assert.equal(
      await windowsSessionPath({ run, env }),
      'C:\\WINDOWS\\system32;C:\\Program Files\\nodejs\\;C:\\Users\\François\\AppData\\Local\\Microsoft\\WindowsApps;%INCONNUE%\\bin',
    )
    assert.deepEqual(calls.map((call) => call.file), ['C:\\WINDOWS\\System32\\reg.exe', 'C:\\WINDOWS\\System32\\reg.exe'])
    assert.deepEqual(calls[1].args, ['query', 'HKCU\\Environment', '/v', 'Path'])
    assert.ok(calls.every((call) => call.windowsHide === true && !call.shell))
    assert.equal(await windowsSessionPath({ run: (_f, _a, _o, done) => done(new Error('accès refusé')), env }), null)
  })

  it('lit une valeur de « reg query » et développe les variables (casse indifférente)', () => {
    assert.equal(parseRegValue('\r\nHKEY_CURRENT_USER\\Software\\Atelier\\Apps\\viz\r\n    Lanceur    REG_SZ    C:\\Program Files\\Atelier Viz\\viz.exe\r\n', 'lanceur'), 'C:\\Program Files\\Atelier Viz\\viz.exe')
    assert.equal(parseRegValue('ERREUR : clé introuvable', 'Lanceur'), null)
    assert.equal(expandWindowsVars('%localappdata%\\x;%NON%', env), 'C:\\Users\\François\\AppData\\Local\\x;%NON%')
  })

  it('npm sans shell : node.exe + npm-cli.js à côté, sinon npm.exe (Volta), jamais npm.cmd', () => {
    const official = new Set(['C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'])
    assert.deepEqual(npmCommand({ platform: 'win32', pathValue: 'C:\\Program Files\\nodejs;C:\\WINDOWS', exists: (file) => official.has(file) }), [
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
    ])
    const volta = new Set(['C:\\Program Files\\Volta\\node.exe', 'C:\\Program Files\\Volta\\npm.exe'])
    assert.deepEqual(npmCommand({ platform: 'win32', pathValue: 'C:\\Program Files\\Volta', exists: (file) => volta.has(file) }), ['C:\\Program Files\\Volta\\npm.exe'])
    assert.equal(npmCommand({ platform: 'win32', pathValue: 'C:\\Program Files\\nodejs', exists: (file) => file.endsWith('npm.cmd') }), null)
    assert.deepEqual(npmCommand({ platform: 'darwin', pathValue: '/usr/bin' }), ['npm'])
  })

  it('dossiers : absolus Windows seulement, sans node_modules\\.bin', () => {
    assert.equal(usableDir('C:\\Program Files\\nodejs', 'win32'), true)
    assert.equal(usableDir('nodejs', 'win32'), false)
    assert.equal(usableDir('C:\\depot\\node_modules\\.bin', 'win32'), false)
  })
})
