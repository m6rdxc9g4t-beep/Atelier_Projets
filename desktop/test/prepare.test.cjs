// Mise à jour automatique au lancement (docs/SUITE.md §8) : plan, npm ci depuis le lockfile, compilation à part
// puis échange, version précédente remise en place en cas d'échec, verrou, journal. npm est simulé
// (test/fixtures/fake-npm.cjs) dans un dépôt Git temporaire ; aucun réseau.
'use strict'

const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { after, before, beforeEach, describe, it } = require('node:test')
const { acquireLock, plan, prepare, recover, rotateLog, UpdateError, LOCK, STAMP } = require('../lib/prepare.cjs')

const FAKE_NPM = path.join(__dirname, 'fixtures', 'fake-npm.cjs')

let root
let repo
let logFile
let callsFile

function write(file, content) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  fs.writeFileSync(path.join(repo, file), content)
}
const read = (file) => fs.readFileSync(path.join(repo, file), 'utf8')
const exists = (file) => fs.existsSync(path.join(repo, file))

function git(...args) {
  execFileSync('git', ['-c', 'user.name=Camille Test', '-c', 'user.email=camille@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repo,
    stdio: 'ignore',
  })
}

function calls() {
  if (!fs.existsSync(callsFile)) return []
  return fs
    .readFileSync(callsFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function run(fail, extra = {}) {
  fs.rmSync(callsFile, { force: true })
  return prepare(repo, { npm: FAKE_NPM, logFile, env: { ...process.env, FAKE_NPM_CALLS: callsFile, FAKE_NPM_FAIL: fail ?? '' }, ...extra })
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-prepare-'))
  const gitConfig = path.join(root, 'gitconfig')
  fs.writeFileSync(gitConfig, '')
  process.env.GIT_CONFIG_GLOBAL = gitConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  repo = path.join(root, 'depot')
  fs.mkdirSync(repo)
  logFile = path.join(root, 'logs', 'mise-a-jour.log')
  callsFile = path.join(root, 'appels.jsonl')
  write('package.json', JSON.stringify({ name: 'depot', workspaces: ['backend', 'frontend'] }))
  write('package-lock.json', '{"lockfileVersion":3,"v":1}')
  write('backend/src/server.ts', 'export {}')
  write('.gitignore', 'node_modules/\ndist/\nbackend/src/generated/\ndesktop/.build-stamp.json\ndesktop/.update.lock\n*.avant-maj/\n*.a-supprimer/\ndist.maj/\n')
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: repo, stdio: 'ignore' })
  git('add', '-A')
  git('commit', '-m', 'init')
  // Version déjà installée et compilée (avant le « git pull »).
  write('node_modules/.package-lock.json', 'ancien')
  write('backend/node_modules/module-local/index.js', 'ancien')
  write('backend/dist/server.js', 'ancien')
  write('frontend/dist/index.html', 'ancien')
  write('backend/src/generated/index.ts', '')
})

after(() => fs.rmSync(root, { recursive: true, force: true }))

describe('mise à jour au lancement', () => {
  beforeEach(settle)

  it('premier lancement : génère, sauvegarde/migre (db:deploy), compile à part puis remplace dist', async () => {
    assert.deepEqual(plan(repo).steps, ['generate', 'migrate', 'build'])
    const status = []
    assert.deepEqual(await run(null, { onStatus: (text) => status.push(text) }), ['generate', 'migrate', 'build'])
    assert.deepEqual(
      calls().map((call) => call.args.join(' ')),
      [
        'run db:generate --workspace=@atelier/backend',
        'run db:deploy --workspace=@atelier/backend',
        'run build --workspace=@atelier/backend -- --outDir dist.maj',
        'run build --workspace=@atelier/frontend -- --outDir dist.maj',
      ],
    )
    // Pendant la compilation, l'ancienne version reste en place.
    assert.ok(calls().filter((call) => call.args[1] === 'build').every((call) => call.distBefore === 'ancien'))
    assert.equal(read('backend/dist/server.js'), 'nouveau')
    assert.equal(read('frontend/dist/index.html'), 'nouveau')
    await settle()
    for (const dir of ['backend/dist.maj', 'backend/dist.avant-maj', 'backend/dist.a-supprimer', 'frontend/dist.a-supprimer']) assert.equal(exists(dir), false, dir)
    assert.ok(JSON.parse(read(STAMP)).builtAt)
    assert.equal(exists(LOCK), false)
    assert.ok(status.includes('Compilation de l’API et de l’interface…'))
    assert.match(fs.readFileSync(logFile, 'utf8'), /===== Mise à jour du .*\n[^]*✔ Mise à jour terminée\./)
  })

  it('dépôt inchangé : migrations vérifiées seulement (copie de la base seulement si elles sont en attente)', async () => {
    assert.deepEqual(await run(), ['migrate'])
    assert.deepEqual(calls().map((call) => call.args[1]), ['db:deploy'])
    assert.match(fs.readFileSync(logFile, 'utf8'), /--- Lancement du .* : dépôt à jour, migrations vérifiées ---/)
  })

  it('lockfile modifié : npm ci (jamais npm install), node_modules de chaque workspace mis de côté, lockfile intact', async () => {
    write('package-lock.json', '{"lockfileVersion":3,"v":2}')
    git('commit', '-am', 'deps')
    assert.deepEqual(await run(), ['install', 'generate', 'migrate', 'build'])
    const [install] = calls()
    assert.deepEqual(install.args, ['ci', '--include=dev', '--no-audit', '--no-fund'])
    assert.deepEqual(install.modulesBefore, { root: false, backend: false })
    assert.equal(read('package-lock.json'), '{"lockfileVersion":3,"v":2}')
    assert.equal(read('node_modules/.package-lock.json'), 'nouveau')
    assert.equal(read('backend/node_modules/module-local/index.js'), 'nouveau')
    await settle()
    assert.equal(exists('node_modules.avant-maj'), false)
    assert.equal(exists('backend/node_modules.avant-maj'), false)
    assert.deepEqual(await run(), ['migrate'])
  })

  it('compilation en échec : version précédente intacte, tampon inchangé, message et journal', async () => {
    write('backend/src/server.ts', 'export const modifie = true') // modification locale non commitée : compte
    const stamp = read(STAMP)
    write('backend/dist/server.js', 'précédente')
    await assert.rejects(run('build-frontend'), (error) => {
      assert.ok(error instanceof UpdateError)
      assert.equal(error.step, 'build')
      assert.equal(error.canUsePrevious, true)
      assert.equal(error.logFile, logFile)
      assert.match(error.message, /^La mise à jour a échoué à l’étape « Compilation » : « npm run build --workspace=@atelier\/frontend -- --outDir dist\.maj » s’est arrêté \(code 2\)\.$/)
      return true
    })
    assert.equal(read('backend/dist/server.js'), 'précédente')
    assert.equal(read('frontend/dist/index.html'), 'nouveau')
    assert.equal(exists('backend/dist.maj'), false)
    assert.equal(exists('frontend/dist.maj'), false)
    assert.equal(read(STAMP), stamp)
    assert.equal(exists(LOCK), false)
    assert.match(fs.readFileSync(logFile, 'utf8'), /✘ Échec \(build\) : .*\n {2}Version précédente remise en place\./)
    // Le lancement suivant réessaie.
    assert.deepEqual(plan(repo).steps, ['generate', 'migrate', 'build'])
  })

  it('npm ci en échec (réseau) : dépendances précédentes remises en place, version précédente utilisable', async () => {
    write('package-lock.json', '{"lockfileVersion":3,"v":3}')
    await assert.rejects(run('ci'), (error) => {
      assert.equal(error.step, 'install')
      assert.equal(error.canUsePrevious, true)
      assert.match(error.hint, /registre npm/)
      return true
    })
    assert.equal(read('node_modules/.package-lock.json'), 'nouveau')
    assert.equal(exists('node_modules/partiel'), false)
    assert.equal(read('backend/node_modules/module-local/index.js'), 'nouveau')
    assert.equal(exists('node_modules.avant-maj'), false)
  })

  it('migrations en échec : l’erreur rappelle la copie faite avant, rien n’est compilé', async () => {
    await assert.rejects(run('db:deploy'), (error) => {
      assert.equal(error.step, 'migrate')
      assert.match(error.hint, /copie de la base/)
      return true
    })
    assert.equal(calls().some((call) => call.args[1] === 'build'), false)
    assert.equal(read('node_modules/.package-lock.json'), 'nouveau')
  })

  it('sans compilation précédente : pas de proposition d’ouvrir l’ancienne version', async () => {
    fs.rmSync(path.join(repo, 'frontend', 'dist'), { recursive: true })
    await assert.rejects(run('build-frontend'), (error) => error.canUsePrevious === false)
    assert.equal(exists('frontend/dist'), false)
    assert.deepEqual(await run(), ['install', 'generate', 'migrate', 'build'])
    assert.equal(read('frontend/dist/index.html'), 'nouveau')
  })

  it('reprend une mise à jour interrompue : version mise de côté remise en place, compilation partielle supprimée', () => {
    write('backend/dist.avant-maj/server.js', 'précédente')
    write('backend/dist/server.js', 'à moitié')
    write('frontend/dist.maj/index.html', 'partiel')
    assert.deepEqual(recover(repo), [path.join('backend', 'dist')])
    assert.equal(read('backend/dist/server.js'), 'précédente')
    assert.equal(exists('backend/dist.avant-maj'), false)
    assert.equal(exists('frontend/dist.maj'), false)
  })
})

describe('verrou de mise à jour', () => {
  it('une seule mise à jour à la fois : la seconde attend la fin de la première', async () => {
    const release = await acquireLock(repo)
    const status = []
    let done = false
    const second = run(null, { onStatus: (text) => status.push(text), lockOptions: { pollMs: 20 } }).then((steps) => {
      done = true
      return steps
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(done, false)
    assert.deepEqual(calls(), [])
    assert.deepEqual(status, ['Une autre mise à jour d’Atelier Projets est en cours : attente de sa fin…'])
    release()
    assert.deepEqual(await second, ['migrate'])
    assert.equal(exists(LOCK), false)
  })

  it('reprend un verrou abandonné (processus arrêté, ou trop ancien)', async () => {
    const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid
    fs.writeFileSync(path.join(repo, LOCK), JSON.stringify({ pid: dead, since: new Date().toISOString() }))
    ;(await acquireLock(repo, { pollMs: 10, timeoutMs: 500 }))()
    fs.writeFileSync(path.join(repo, LOCK), JSON.stringify({ pid: process.pid, since: '2020-01-01T00:00:00.000Z' }))
    ;(await acquireLock(repo, { pollMs: 10, timeoutMs: 500 }))()
    fs.writeFileSync(path.join(repo, LOCK), JSON.stringify({ pid: process.pid, since: new Date().toISOString() }))
    await assert.rejects(acquireLock(repo, { pollMs: 10, timeoutMs: 50 }), /Une autre mise à jour/)
    fs.rmSync(path.join(repo, LOCK))
  })

  it('ne relâche pas le verrou d’un autre', async () => {
    const release = await acquireLock(repo)
    fs.writeFileSync(path.join(repo, LOCK), JSON.stringify({ pid: 1, since: new Date().toISOString() }))
    release()
    assert.equal(exists(LOCK), true)
    fs.rmSync(path.join(repo, LOCK))
  })
})

describe('journal', () => {
  it('passe à mise-a-jour.1.log au-delà de la taille maximale', () => {
    const file = path.join(root, 'rotation', 'mise-a-jour.log')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'x'.repeat(100))
    rotateLog(file, 200)
    assert.equal(fs.existsSync(file), true)
    rotateLog(file, 50)
    assert.equal(fs.existsSync(file), false)
    assert.equal(fs.readFileSync(path.join(root, 'rotation', 'mise-a-jour.1.log'), 'utf8').length, 100)
  })
})
