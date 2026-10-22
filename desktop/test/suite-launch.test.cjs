// Suite Atelier : ouverture des apps de bureau depuis le sélecteur (docs/SUITE.md §3, §9.4) — macOS (open -b) et
// Windows (lanceur lu dans le registre), environnement minimal transmis. Sans Electron ni vrai registre.
'use strict'

const assert = require('node:assert/strict')
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

describe('Windows : lanceur inscrit dans HKCU\\Software\\Atelier\\Apps, ouvert par l’Explorateur (§9.4, §9.6)', () => {
  const windowsEnv = {
    USERPROFILE: 'C:\\Users\\François',
    USERNAME: 'François',
    SystemRoot: 'C:\\WINDOWS',
    Path: 'C:\\depot\\node_modules\\.bin;C:\\WINDOWS\\system32',
    DATABASE_URL: 'file:./prisma/dev.db',
    ATELIER_REPO: 'C:\\Users\\François\\Atelier_Projets',
    ELECTRON_RUN_AS_NODE: '1',
  }
  const LNK = 'C:\\Users\\François\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Atelier\\Atelier Tab.lnk'

  function windowsDeps({ launchers = {}, missing = [], result = null } = {}) {
    const calls = { registry: [], exec: [], external: [] }
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
        execFile: (file, args, options, done) => {
          calls.exec.push({ file, args, options })
          setImmediate(() => done(result))
        },
        openExternal: async (url) => calls.external.push(url),
      },
    }
  }

  it('ouvre le raccourci inscrit par explorer.exe (execFile, sans shell), avec l’environnement minimal', async () => {
    const { calls, deps } = windowsDeps({ launchers: { tab: LNK } })
    assert.equal(await openSuiteOrExternal('http://127.0.0.1:4175/', deps), 'app')
    assert.deepEqual(calls.registry, ['HKCU\\Software\\Atelier\\Apps\\tab Lanceur'])
    const [{ file, args, options }] = calls.exec
    assert.equal(file, 'C:\\WINDOWS\\explorer.exe')
    assert.deepEqual(args, [LNK])
    assert.equal(options.shell, undefined)
    assert.deepEqual(options.env, {
      USERPROFILE: 'C:\\Users\\François',
      USERNAME: 'François',
      SystemRoot: 'C:\\WINDOWS',
      Path: 'C:\\WINDOWS\\system32;C:\\Program Files\\nodejs',
    })
    assert.deepEqual(calls.external, [])
  })

  it('toujours par l’Explorateur, quelle que soit l’extension ; code de sortie non nul de l’Explorateur = ouvert', async () => {
    for (const launcher of ['C:\\Apps\\Atelier Viz\\viz.exe', 'C:\\Apps\\lancer.vbs', 'C:\\Apps\\viz.cmd']) {
      const { calls, deps } = windowsDeps({ launchers: { viz: launcher }, result: Object.assign(new Error('Command failed'), { code: 1 }) })
      assert.equal(await openSuiteOrExternal('http://127.0.0.1:8000', deps), 'app')
      assert.deepEqual(calls.exec.map((call) => [call.file, ...call.args]), [['C:\\WINDOWS\\explorer.exe', launcher]])
    }
    assert.deepEqual(windowsLaunchCommand('viz.lnk', {}), null)
    assert.deepEqual(windowsLaunchCommand('\\\\serveur\\partage\\viz.lnk', {}), null)
    assert.deepEqual(windowsLaunchCommand(null, {}), null)
    assert.deepEqual(windowsLaunchCommand('D:\\Viz.lnk', {}), ['C:\\Windows\\explorer.exe', 'D:\\Viz.lnk'])
  })

  it('navigateur si l’app n’est pas inscrite, si le raccourci a disparu ou si l’Explorateur ne démarre pas', async () => {
    const none = windowsDeps()
    assert.equal(await openSuiteOrExternal('http://127.0.0.1:8000', none.deps), 'browser')
    assert.deepEqual(none.calls.external, ['http://127.0.0.1:8000'])
    const gone = windowsDeps({ launchers: { viz: LNK }, missing: [LNK] })
    assert.equal(await openSuiteOrExternal('http://127.0.0.1:8000', gone.deps), 'browser')
    assert.deepEqual(gone.calls.exec, [])
    const broken = windowsDeps({ launchers: { viz: LNK }, result: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) })
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
