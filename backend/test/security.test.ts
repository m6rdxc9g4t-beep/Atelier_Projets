// L'API locale refuse les hôtes étrangers (DNS rebinding) et les écritures venant d'un autre site (CSRF).
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { allowedHosts, hostName } from '../src/http/local-only.ts'
import { createTestContext, type TestContext } from './helpers/test-app.ts'

describe('API réservée aux requêtes locales', () => {
  let ctx: TestContext
  before(async () => {
    ctx = await createTestContext({ seed: true, publicUrl: 'http://127.0.0.1:3000', allowedHosts: ['mon-mac.local'] })
  })
  after(() => ctx.close())

  const request = (method: 'GET' | 'PATCH', headers: Record<string, string>) =>
    ctx.app.inject({ method, url: `/api/projects/${ctx.demoProjectId}`, headers, ...(method === 'PATCH' && { payload: { description: 'x' } }) })

  it('lit les noms d’hôte des en-têtes Host et Origin', () => {
    assert.equal(hostName('127.0.0.1:3000'), '127.0.0.1')
    assert.equal(hostName('[::1]:3000'), '::1')
    assert.equal(hostName('LocalHost'), 'localhost')
    assert.equal(hostName('::1'), '::1')
    assert.deepEqual([...allowedHosts('0.0.0.0', ['Mon-Mac.local:3000'])], ['127.0.0.1', 'localhost', '::1', 'mon-mac.local'])
  })

  it('accepte les hôtes locaux et ceux de ALLOWED_HOSTS', async () => {
    for (const host of ['127.0.0.1:3000', 'localhost:5173', '[::1]:3000', 'mon-mac.local:3000']) {
      assert.equal((await request('GET', { host })).statusCode, 200, host)
    }
  })

  it('refuse un hôte étranger (DNS rebinding), même en lecture', async () => {
    const response = await request('GET', { host: 'rebind.attacker.example:3000' })
    assert.equal(response.statusCode, 403)
    assert.equal(response.json().code, 'FORBIDDEN_HOST')
  })

  it('refuse une écriture venant d’un autre site, accepte l’interface locale et les outils sans Origin', async () => {
    const foreign = await request('PATCH', { host: '127.0.0.1:3000', origin: 'https://evil.example' })
    assert.equal(foreign.statusCode, 403)
    assert.equal(foreign.json().code, 'FORBIDDEN_ORIGIN')
    assert.equal((await request('PATCH', { host: '127.0.0.1:3000', origin: 'null' })).statusCode, 403)
    assert.equal((await request('GET', { host: '127.0.0.1:3000', origin: 'https://evil.example' })).statusCode, 200)
    assert.equal((await request('PATCH', { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' })).statusCode, 200)
    assert.equal((await request('PATCH', { host: '127.0.0.1:3000' })).statusCode, 200, 'curl du hook post-commit')
  })
})
