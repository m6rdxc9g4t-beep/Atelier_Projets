// Suite Atelier : ouverture des apps de bureau depuis le sélecteur (docs/SUITE.md §3, §9.4) — macOS (open -b) et
// Windows (lanceur lu dans le registre), environnement minimal transmis. Sans Electron ni vrai registre.
'use strict'

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { describe, it } = require('node:test')
const { suiteBundleFor, openSuiteOrExternal, windowsLaunchCommand } = require('../lib/suite-launch.cjs')

const PARENT_ENV = {
  HOME: '/Users/camille',
  USER: 'camille',
  LANG: 'fr_FR.UTF-8',
  PATH: '/Users/camille/.nvm/versions/node/v24.1.0/bin:/usr/bin',
  DATABASE_URL: 'file:./prisma/dev.db',
  PORT: '3000',
  ATELIER_REPO: '/Users/camille/Atelier_Projets',
  ELECTRON_RUN_AS_NODE: '1',
}

function fakeDeps({ platform = 'darwin', fail = false } = {}) {
  const calls = { exec: [], external: [], env: [] }
  return {
    calls,
    deps: {
      platform,
      env: PARENT_ENV,
      execFile: (file, args, options, done) => {
        calls.exec.push([file, ...args])
        calls.env.push(options.env)
        done(fail ? new Error('Application introuvable') : null)
      },
      openExternal: (url) => {
        calls.external.push(url)
        return Promise.resolve()
      },
    },
  }
}

describe('suiteBundleFor', () => {
  it('reconnaît les trois apps par hôte local et port', () => {
    assert.equal(suiteBundleFor('http://127.0.0.1:8000'), 'fr.atelier-viz.app')
    assert.equal(suiteBundleFor('http://localhost:4175/'), 'fr.atelier.tab')
    assert.equal(suiteBundleFor('http://127.0.0.1:4174/#/gantt'), 'local.atelier-projets.desktop')
  })

  it('reconnaît Atelier Cuisine par son adresse en ligne (https, hôte exact)', () => {
    assert.equal(suiteBundleFor('https://atelier-cuisine-iota.vercel.app'), 'fr.ateliercuisine.app')
    assert.equal(suiteBundleFor('https://atelier-cuisine-iota.vercel.app/stock?x=1'), 'fr.ateliercuisine.app')
    // Ni http, ni autre port, ni identifiants, ni hôte voisin.
    assert.equal(suiteBundleFor('http://atelier-cuisine-iota.vercel.app'), null)
    assert.equal(suiteBundleFor('https://atelier-cuisine-iota.vercel.app:8443'), null)
    assert.equal(suiteBundleFor('https://u:p@atelier-cuisine-iota.vercel.app'), null)
    assert.equal(suiteBundleFor('https://evil.atelier-cuisine-iota.vercel.app'), null)
    assert.equal(suiteBundleFor('https://atelier-cuisine-iota.vercel.app.evil.com'), null)
    assert.equal(suiteBundleFor('https://vercel.app'), null)
    assert.equal(suiteBundleFor('https://constructor'), null)
    assert.equal(suiteBundleFor('http://u:p@127.0.0.1:4175'), null)
  })

  it('ignore les autres adresses', () => {
    assert.equal(suiteBundleFor('https://github.com/x/y'), null)
    assert.equal(suiteBundleFor('http://127.0.0.1:3000/api/docs'), null)
    assert.equal(suiteBundleFor('http://192.168.1.10:8000'), null)
    assert.equal(suiteBundleFor('https://127.0.0.1:8000'), null)
    assert.equal(suiteBundleFor('pas une adresse'), null)
  })
})

describe('openSuiteOrExternal', () => {
  it("ouvre l'app installée sur macOS, sans shell", async () => {
    const { calls, deps } = fakeDeps()
    assert.equal(await openSuiteOrExternal('http://127.0.0.1:4175', deps), 'app')
    assert.deepEqual(calls.exec, [['/usr/bin/open', '-b', 'fr.atelier.tab']])
    assert.deepEqual(calls.external, [])
    // Environnement minimal : ni DATABASE_URL, ni PORT, ni ATELIER_*, ni ELECTRON_* ; PATH système.
    assert.deepEqual(calls.env, [{ HOME: '/Users/camille', USER: 'camille', LANG: 'fr_FR.UTF-8', PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }])
  })

  it("revient au navigateur si l'app n'est pas installée", async () => {
    const { calls, deps } = fakeDeps({ fail: true })
    assert.equal(await openSuiteOrExternal('http://127.0.0.1:8000', deps), 'browser')
    assert.deepEqual(calls.external, ['http://127.0.0.1:8000'])
  })

  it("ouvre l'app Mac d'Atelier Cuisine, sinon sa PWA dans le navigateur", async () => {
    const url = 'https://atelier-cuisine-iota.vercel.app'
    const installed = fakeDeps()
    assert.equal(await openSuiteOrExternal(url, installed.deps), 'app')
    assert.deepEqual(installed.calls.exec, [['/usr/bin/open', '-b', 'fr.ateliercuisine.app']])
    assert.deepEqual(installed.calls.external, [])
    const missing = fakeDeps({ fail: true })
    assert.equal(await openSuiteOrExternal(url, missing.deps), 'browser')
    assert.deepEqual(missing.calls.external, [url])
  })

  it('navigateur pour une adresse hors suite ou hors macOS', async () => {
    const other = fakeDeps()
    assert.equal(await openSuiteOrExternal('https://github.com', other.deps), 'browser')
    assert.deepEqual(other.calls.exec, [])
    const linux = fakeDeps({ platform: 'linux' })
    assert.equal(await openSuiteOrExternal('http://127.0.0.1:8000', linux.deps), 'browser')
    assert.deepEqual(linux.calls.exec, [])
  })
})

describe('Windows : lanceur enregistré dans HKCU\\Software\\Atelier\\Apps (§9.4)', () => {
  const windowsEnv = {
    USERPROFILE: 'C:\\Users\\François',
    USERNAME: 'François',
    SystemRoot: 'C:\\WINDOWS',
    Path: 'C:\\depot\\node_modules\\.bin;C:\\WINDOWS\\system32',
    DATABASE_URL: 'file:./prisma/dev.db',
    ATELIER_REPO: 'C:\\Users\\François\\Atelier_Projets',
  }

  function windowsDeps({ launchers = {}, missing = [], spawnFails = false } = {}) {
    const calls = { registry: [], spawn: [], external: [] }
    return {
      calls,
      deps: {
        platform: 'win32',
        env: windowsEnv,
        readRegistry: async (key, name) => {
          calls.registry.push(`${key} ${name}`)
          return launchers[key.split('\\').pop()] ?? null
        },
        sessionPath: async () => 'C:\\WINDOWS\\system32;C:\\Program Files\\nodejs',
        exists: (file) => !missing.includes(file),
        spawn: (file, args, options) => {
          calls.spawn.push({ file, args, options })
          const child = new EventEmitter()
          child.unref = () => (calls.unref = true)
          setImmediate(() => (spawnFails ? child.emit('error', new Error('ENOENT')) : child.emit('spawn')))
          return child
        },
        openExternal: async (url) => calls.external.push(url),
      },
    }
  }

  it('démarre le lanceur de l’app (exe), détaché, sans shell, avec un environnement minimal', async () => {
    const exe = 'C:\\Users\\François\\AppData\\Local\\Programs\\Atelier_Tab\\Atelier Tab.exe'
    const { calls, deps } = windowsDeps({ launchers: { tab: exe } })
    assert.equal(await openSuiteOrExternal('http://127.0.0.1:4175/', deps), 'app')
    assert.deepEqual(calls.registry, ['HKCU\\Software\\Atelier\\Apps\\tab Lanceur'])
    const [{ file, args, options }] = calls.spawn
    assert.equal(file, exe)
    assert.deepEqual(args, [])
    assert.equal(options.detached, true)
    assert.equal(options.shell, undefined)
    assert.deepEqual(options.env, {
      USERPROFILE: 'C:\\Users\\François',
      USERNAME: 'François',
      SystemRoot: 'C:\\WINDOWS',
      Path: 'C:\\WINDOWS\\system32;C:\\Program Files\\nodejs',
    })
    assert.equal(calls.unref, true)
    assert.deepEqual(calls.external, [])
  })

  it('.vbs par wscript.exe, .lnk par l’Explorateur ; types inconnus, chemins relatifs ou réseau refusés', () => {
    const env = { SystemRoot: 'C:\\WINDOWS' }
    assert.deepEqual(windowsLaunchCommand('C:\\Apps\\Atelier Viz\\lancer.vbs', env), ['C:\\WINDOWS\\System32\\wscript.exe', 'C:\\Apps\\Atelier Viz\\lancer.vbs'])
    assert.deepEqual(windowsLaunchCommand('C:\\Apps\\Viz.lnk', env), ['C:\\WINDOWS\\explorer.exe', 'C:\\Apps\\Viz.lnk'])
    assert.equal(windowsLaunchCommand('C:\\Apps\\viz.cmd', env), null)
    assert.equal(windowsLaunchCommand('viz.exe', env), null)
    assert.equal(windowsLaunchCommand('\\\\serveur\\partage\\viz.exe', env), null)
    assert.equal(windowsLaunchCommand(null, env), null)
  })

  it('navigateur si l’app n’est pas enregistrée, si le lanceur a disparu ou ne démarre pas', async () => {
    const none = windowsDeps()
    assert.equal(await openSuiteOrExternal('http://127.0.0.1:8000', none.deps), 'browser')
    assert.deepEqual(none.calls.external, ['http://127.0.0.1:8000'])
    const exe = 'C:\\Apps\\viz.exe'
    const gone = windowsDeps({ launchers: { viz: exe }, missing: [exe] })
    assert.equal(await openSuiteOrExternal('http://127.0.0.1:8000', gone.deps), 'browser')
    assert.deepEqual(gone.calls.spawn, [])
    const broken = windowsDeps({ launchers: { viz: exe }, spawnFails: true })
    assert.equal(await openSuiteOrExternal('http://127.0.0.1:8000', broken.deps), 'browser')
    assert.deepEqual(broken.calls.external, ['http://127.0.0.1:8000'])
  })

  it('Atelier Cuisine (pas d’app Windows) et adresses hors suite : navigateur, registre jamais lu', async () => {
    const { calls, deps } = windowsDeps()
    assert.equal(await openSuiteOrExternal('https://atelier-cuisine-iota.vercel.app', deps), 'browser')
    assert.equal(await openSuiteOrExternal('https://github.com', deps), 'browser')
    assert.deepEqual(calls.registry, [])
    assert.deepEqual(calls.external, ['https://atelier-cuisine-iota.vercel.app', 'https://github.com'])
  })
})
