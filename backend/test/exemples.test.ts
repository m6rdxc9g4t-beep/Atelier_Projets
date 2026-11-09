// Exemples de la suite : chaque histoire crée son projet complet (et la tâche née de l'alerte de Viz), puis se retire.
import { existsSync } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { BACKEND_ROOT } from '../src/config.ts'
import { call, createTestContext, type TestContext } from './helpers/test-app.ts'

const NOW = new Date('2026-11-09T18:00:00Z')

describe('exemples de la suite', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestContext({ now: () => NOW })
  })
  afterEach(async () => ctx.close())

  it('livre les exemples dans le dépôt', () => {
    assert.ok(existsSync(path.join(BACKEND_ROOT, '..', 'exemples-suite', 'index.json')))
  })

  it('charge chaque histoire : projet, alerte, jalons, temps passés', async () => {
    const { body: histoires } = await call<any[]>(ctx.app, 'GET', '/api/exemples-suite')
    assert.ok(histoires.length >= 9)
    for (const h of histoires) {
      assert.equal(h.charge, false)
      assert.ok(h.parcours.some((e: { app: string }) => e.app === 'projets'))
      const { status, body } = await call(ctx.app, 'POST', `/api/exemples-suite/${h.id}`)
      assert.equal(status, 200, JSON.stringify(body))
      assert.ok(body.storyAlerteId > 0)
      const items = await call<any[]>(ctx.app, 'GET', `/api/stories/${body.storyAlerteId}/work-items`)
      assert.ok(items.body.some((w: any) => w.title.startsWith('Alerte') && w.priority === 'HIGH'))
      const milestones = await call<any[]>(ctx.app, 'GET', `/api/projects/${body.projectId}/milestones`)
      assert.equal(milestones.body.length, h.jalons)
    }
    const listed = await call<any[]>(ctx.app, 'GET', '/api/exemples-suite')
    assert.ok(listed.body.every((h) => h.charge))
    // Les écritures passent par les services : événements du nœud Atelier émis.
    const events = await call<any>(ctx.app, 'GET', '/api/atelier/events?types=projets.work_item.created&limit=500')
    assert.ok(events.body.events.length > histoires.length * 3)
  })

  it('ne duplique rien au rechargement et retire seulement son projet', async () => {
    const other = await call(ctx.app, 'POST', '/api/projects', { name: 'Mon vrai projet' })
    const first = await call(ctx.app, 'POST', '/api/exemples-suite/studio-garance')
    const again = await call(ctx.app, 'POST', '/api/exemples-suite/studio-garance')
    assert.equal(again.body.projectId, first.body.projectId)
    assert.equal(again.body.dejaCharge, true)
    assert.equal((await call<any[]>(ctx.app, 'GET', '/api/projects')).body.length, 2)

    assert.equal((await call(ctx.app, 'DELETE', '/api/exemples-suite/studio-garance')).status, 204)
    const projects = (await call<any[]>(ctx.app, 'GET', '/api/projects')).body
    assert.deepEqual(projects.map((p) => p.id), [other.body.id])
    assert.equal((await call(ctx.app, 'DELETE', '/api/exemples-suite/studio-garance')).status, 404)
  })

  it('refuse un projet du même nom et une histoire inconnue', async () => {
    await call(ctx.app, 'POST', '/api/projects', { name: 'Gestion 2026 — Studio Garance' })
    assert.equal((await call(ctx.app, 'POST', '/api/exemples-suite/studio-garance')).status, 409)
    assert.equal((await call(ctx.app, 'POST', '/api/exemples-suite/inconnue')).status, 404)
    assert.equal((await call(ctx.app, 'POST', '/api/exemples-suite/..%2Fx')).status, 400)
  })

  it('liste vide sans dossier d’exemples', async () => {
    const empty = await createTestContext({ exemplesDir: '/chemin/absent' })
    try {
      assert.deepEqual((await call(empty.app, 'GET', '/api/exemples-suite')).body, [])
    } finally {
      await empty.close()
    }
  })
})
