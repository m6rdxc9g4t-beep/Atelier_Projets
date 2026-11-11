// Exemples de la suite : chaque histoire crée son projet complet (et la tâche née de l'alerte de Viz), puis se retire.
import { existsSync } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { BACKEND_ROOT } from '../src/config.ts'
import { planItem, projectFrame, type Item } from '../src/services/exemples.ts'
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

  it('donne au projet un budget, des dates et des éléments planifiés (Gantt, santé du budget)', async () => {
    const { body } = await call(ctx.app, 'POST', '/api/exemples-suite/renovation-urbaine')
    const project = (await call(ctx.app, 'GET', `/api/projects/${body.projectId}`)).body
    assert.deepEqual(project.budget, { hours: 242, days: 30.25 })
    assert.deepEqual([project.startDate, project.dueDate], ['2026-10-29', '2027-02-28'])

    const dashboard = (await call(ctx.app, 'GET', `/api/projects/${body.projectId}/dashboard`)).body
    assert.equal(dashboard.budget.initial.hours, 242)
    assert.equal(dashboard.budget.consumedPercent, 47.5)
    assert.notEqual(dashboard.trend, null)
    assert.ok(dashboard.progress.percent > 0)

    const items = (await call<any[]>(ctx.app, 'GET', `/api/projects/${body.projectId}/work-items`)).body
    const byTitle = (title: string) => items.find((item) => item.title === title)
    // En cours, 52 h passées sur 75 : commencé à la première journée saisie, avancé de 70 %.
    const grosOeuvre = byTitle('Gros œuvre')
    assert.deepEqual([grosOeuvre.startDate, grosOeuvre.dueDate, grosOeuvre.progress], ['2026-10-29', '2026-11-30', 70])
    // À faire, 25 h estimées : 4 jours ouvrés avant l'échéance, pas d'avancement.
    const isolation = byTitle('Isolation thermique')
    assert.deepEqual([isolation.startDate, isolation.dueDate, isolation.progress], ['2027-01-15', '2027-01-20', 0])
    assert.equal(byTitle('Charpente bois').progress, 100)

    // Histoire sans estimation : pas de budget inventé.
    const sans = await call(ctx.app, 'POST', '/api/exemples-suite/finance-patrimoine')
    const sansBudget = (await call(ctx.app, 'GET', `/api/projects/${sans.body.projectId}/dashboard`)).body
    assert.deepEqual([sansBudget.budget.initial, sansBudget.trend], [null, null])
    assert.deepEqual(
      [sansBudget.project.startDate, sansBudget.project.dueDate],
      ['2026-10-01', '2026-12-10'],
    )
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

describe('plan déduit d’un élément d’exemple (fonctions pures)', () => {
  const clock = { timeZone: 'Europe/Paris', now: NOW }
  const item = (fields: Partial<Item>): Item => ({
    titre: 'X', type: 'TASK', statut: 'OPEN', priorite: 'NORMAL', estime: null, passe: null, echeance: null, ...fields,
  })

  it('pose le début avant l’échéance selon l’estimation, en jours ouvrés', () => {
    // 15 h → 3 journées de 7 h au plus : vendredi 13, lundi 16, mardi 17.
    assert.deepEqual(planItem(item({ estime: 15, echeance: '2026-11-17' }), clock), { entries: [], startDate: '2026-11-13', progress: null })
    assert.equal(planItem(item({ estime: 15 }), clock).startDate, null)
    assert.equal(planItem(item({ echeance: '2026-11-17' }), clock).startDate, null)
  })

  it('répartit le temps passé jusqu’à aujourd’hui et borne l’avancement', () => {
    const plan = planItem(item({ statut: 'IN_PROGRESS', estime: 10, passe: 9.5, echeance: '2026-11-30' }), clock)
    assert.deepEqual(plan.entries, [{ day: '2026-11-06', hours: 7 }, { day: '2026-11-09', hours: 2.5 }])
    assert.deepEqual([plan.startDate, plan.progress], ['2026-11-06', 90])
    assert.equal(planItem(item({ statut: 'ON_HOLD', estime: 36, passe: 1 }), clock).progress, 5)
    assert.equal(planItem(item({ statut: 'CLOSED', estime: 10, passe: 12 }), clock).progress, null)
  })

  it('cadre le projet : somme des estimations, bornes des éléments et des jalons', () => {
    const rows = [item({ estime: 15, echeance: '2026-11-17' }), item({ estime: 7.5, passe: 3 })].map((it) => ({ it, plan: planItem(it, clock) }))
    assert.deepEqual(projectFrame(rows, ['2026-12-01']), { budgetHours: 22.5, startDate: '2026-11-09', dueDate: '2026-12-01' })
    assert.deepEqual(projectFrame([], []), {})
  })
})
