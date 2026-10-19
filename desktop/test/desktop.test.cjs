// Application de bureau : serveur de l'interface (fichiers, repli monopage, relais /api) et lecture de la
// configuration de l'API. Sans Electron.
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { after, before, describe, it } = require('node:test')
const { readApiAddress, apiStatus } = require('../lib/backend.cjs')
const { startUiServer, resolveFile } = require('../lib/ui-server.cjs')

let dir
let api
let ui
const seen = []

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-desktop-'))
  fs.mkdirSync(path.join(dir, 'dist', 'assets'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'dist', 'index.html'), '<!doctype html><title>Atelier Projets</title>')
  fs.writeFileSync(path.join(dir, 'dist', 'assets', 'app-1234.js'), 'console.log(1)')
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'hors du dossier')
  api = http.createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      seen.push({ method: request.method, url: request.url, host: request.headers.host, origin: request.headers.origin, body })
      if (request.url === '/api/slow') return setTimeout(() => response.end('trop tard'), 2000)
      response.writeHead(201, { 'content-type': 'application/json', 'x-api': 'oui' })
      response.end(JSON.stringify({ status: 'ok', database: 'ok' }))
    })
  })
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
  ui = await startUiServer({ root: path.join(dir, 'dist'), port: 0, apiPort: api.address().port })
})

after(async () => {
  ui.server.close()
  api.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('serveur de l’interface', () => {
  it('sert index.html, les fichiers et le repli monopage', async () => {
    const index = await fetch(`${ui.url}/`)
    assert.equal(index.status, 200)
    assert.match(index.headers.get('content-type'), /text\/html/)
    assert.equal(index.headers.get('cache-control'), 'no-cache')
    const asset = await fetch(`${ui.url}/assets/app-1234.js`)
    assert.match(asset.headers.get('content-type'), /javascript/)
    assert.match(asset.headers.get('cache-control'), /immutable/)
    const route = await fetch(`${ui.url}/projets/12/gantt`)
    assert.equal(route.status, 200)
    assert.match(await route.text(), /Atelier Projets/)
    assert.equal((await fetch(`${ui.url}/assets/absent.js`)).status, 404)
    assert.equal((await fetch(`${ui.url}/`, { method: 'POST' })).status, 405)
  })

  it('ne sort jamais du dossier de l’interface', async () => {
    const root = fs.realpathSync(path.join(dir, 'dist'))
    assert.equal(resolveFile(root, '/../secret.txt'), null)
    assert.equal(resolveFile(root, '/%2e%2e/secret.txt'), null)
    assert.equal(resolveFile(root, '/%00'), null)
    assert.equal(resolveFile(root, '/%E0%A4%A'), null)
    const response = await fetch(`${ui.url}/%2e%2e/secret.txt`)
    assert.doesNotMatch(await response.text(), /hors du dossier/)
  })

  it('relaie /api vers l’API avec méthode, corps, Host et Origin d’origine', async () => {
    const response = await fetch(`${ui.url}/api/projects?x=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ui.url },
      body: JSON.stringify({ name: 'Démo' }),
    })
    assert.equal(response.status, 201)
    assert.equal(response.headers.get('x-api'), 'oui')
    const last = seen.at(-1)
    assert.deepEqual(
      { method: last.method, url: last.url, host: last.host, origin: last.origin, body: last.body },
      { method: 'POST', url: '/api/projects?x=1', host: new URL(ui.url).host, origin: ui.url, body: '{"name":"Démo"}' },
    )
    assert.equal(await apiStatus(ui.url), 'atelier')
  })

  it('annule la requête vers l’API quand l’interface l’abandonne', async () => {
    const closed = new Promise((resolve) => api.once('request', (request) => request.socket.once('close', resolve)))
    await assert.rejects(fetch(`${ui.url}/api/slow`, { signal: AbortSignal.timeout(200) }))
    await closed
  })

  it('répond 502 quand l’API est arrêtée', async () => {
    const orphan = await startUiServer({ root: path.join(dir, 'dist'), port: 0, apiPort: 1 })
    try {
      const response = await fetch(`${orphan.url}/api/health`)
      assert.equal(response.status, 502)
      assert.equal((await response.json()).code, 'API_UNREACHABLE')
    } finally {
      orphan.server.close()
    }
  })

  it('signale un port déjà pris', async () => {
    await assert.rejects(startUiServer({ root: path.join(dir, 'dist'), port: Number(new URL(ui.url).port), apiPort: 1 }), { code: 'EADDRINUSE' })
  })
})

describe('adresse de l’API', () => {
  it('suit backend/.env, puis l’environnement', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-env-'))
    fs.mkdirSync(path.join(repo, 'backend'))
    assert.deepEqual(readApiAddress(repo, {}), { host: '127.0.0.1', port: 3000 })
    fs.writeFileSync(path.join(repo, 'backend', '.env'), '# config\nHOST=0.0.0.0\nPORT="3100" # commentaire\n')
    assert.deepEqual(readApiAddress(repo, {}), { host: '127.0.0.1', port: 3100 })
    assert.deepEqual(readApiAddress(repo, { PORT: '3200' }), { host: '127.0.0.1', port: 3200 })
    fs.rmSync(repo, { recursive: true, force: true })
  })
})
