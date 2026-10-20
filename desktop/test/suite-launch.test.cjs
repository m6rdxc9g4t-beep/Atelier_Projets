// Suite Atelier : ouverture des apps de bureau depuis le sélecteur (docs/SUITE.md §3). Sans Electron.
'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { suiteBundleFor, openSuiteOrExternal } = require('../lib/suite-launch.cjs')

function fakeDeps({ platform = 'darwin', fail = false } = {}) {
  const calls = { exec: [], external: [] }
  return {
    calls,
    deps: {
      platform,
      execFile: (file, args, done) => {
        calls.exec.push([file, ...args])
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
  })

  it("revient au navigateur si l'app n'est pas installée", async () => {
    const { calls, deps } = fakeDeps({ fail: true })
    assert.equal(await openSuiteOrExternal('http://127.0.0.1:8000', deps), 'browser')
    assert.deepEqual(calls.external, ['http://127.0.0.1:8000'])
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
