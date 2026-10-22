// Node.js et npm pour l'application ouverte depuis le Finder (docs/SUITE.md §8) : ordre de recherche (PATH du
// shell de connexion, PATH du lanceur, Homebrew, nvm), version acceptée par le dépôt. Sans macOS : faux node / npm.
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { after, before, describe, it } = require('node:test')
const { candidateDirs, findNode, loginShellPath, nvmDirs, supportedNode, usableDir } = require('../lib/node-path.cjs')

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

describe('recherche de Node.js', () => {
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
