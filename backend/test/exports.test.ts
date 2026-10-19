// Suite Atelier §4.3 : jeux de données pour Atelier Viz, calculés sur le projet de démo.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { call, createTestContext, type TestContext } from './helpers/test-app.ts'

const NOW = new Date('2026-10-19T10:00:00Z')
let ctx: TestContext
before(async () => {
  ctx = await createTestContext({ seed: true, now: () => NOW })
})
after(() => ctx.close())

const get = <T = any>(url: string) => call<T>(ctx.app, 'GET', url)

describe('GET /api/exports/datasets', () => {
  it('liste les trois jeux avec leur nombre de lignes', async () => {
    const { status, body } = await get('/api/exports/datasets')
    assert.equal(status, 200)
    assert.deepEqual(
      body.map((dataset: any) => [dataset.name, dataset.rowCount]),
      [
        ['work-items', 17],
        ['time-entries', await ctx.prisma.timeEntry.count()],
        ['milestones', 3],
      ],
    )
    for (const dataset of body) {
      assert.ok(dataset.label.length > 0)
      assert.ok(dataset.description.length > 0)
    }
  })
})

describe('GET /api/exports/datasets/:name', () => {
  it('work-items : colonnes du contrat, heures passées = somme des saisies, écart = passées − estimées', async () => {
    const { status, body } = await get(`/api/exports/datasets/work-items?projectId=${ctx.demoProjectId}`)
    assert.equal(status, 200)
    assert.equal(body.name, 'work-items')
    assert.equal(body.generatedAt, NOW.toISOString())
    assert.deepEqual(
      body.columns.map((column: any) => column.key),
      [
        'id',
        'projet',
        'phase',
        'epic',
        'story',
        'type',
        'statut',
        'statut_code',
        'priorite',
        'titre',
        'heures_estimees',
        'heures_passees',
        'ecart_heures',
        'avancement',
        'debut',
        'echeance',
        'cree_le',
        'maj_le',
      ],
    )
    const types = Object.fromEntries(body.columns.map((column: any) => [column.key, column.type]))
    assert.equal(types.heures_passees, 'number')
    assert.equal(types.debut, 'date')
    assert.equal(types.cree_le, 'datetime')
    assert.equal(body.columns.find((column: any) => column.key === 'heures_estimees').label, 'Heures estimées')

    assert.equal(body.rows.length, 17)
    const row101 = body.rows.find((row: any) => row.id === 101)
    assert.equal(row101.statut, 'Terminée')
    assert.equal(row101.statut_code, 'CLOSED')
    assert.equal(row101.type, 'FEATURE')
    assert.equal(row101.projet, 'App E-Commerce v2')
    assert.equal(row101.phase, 'Socle Technique')
    assert.equal(row101.epic, 'Architecture')
    assert.equal(row101.story, 'Auth')
    // Tableau des temps de la maquette D : #101 = 3 j (24 h) budgétés, 20 h réalisées.
    assert.equal(row101.heures_estimees, 24)
    assert.equal(row101.heures_passees, 20)
    assert.equal(row101.ecart_heures, -4)
    assert.match(row101.debut, /^\d{4}-\d{2}-\d{2}$/)
    assert.match(row101.cree_le, /^\d{4}-\d{2}-\d{2}T/)

    // Total réalisé du projet (maquette A) : 228 h.
    const spent = body.rows.reduce((sum: number, row: any) => sum + row.heures_passees, 0)
    assert.equal(Math.round(spent * 100) / 100, 228)
    // Chaque ligne a exactement les clés des colonnes.
    for (const row of body.rows) assert.deepEqual(Object.keys(row), body.columns.map((column: any) => column.key))
  })

  it('time-entries et milestones', async () => {
    const entries = await get(`/api/exports/datasets/time-entries?projectId=${ctx.demoProjectId}`)
    assert.equal(entries.status, 200)
    assert.deepEqual(
      entries.body.columns.map((column: any) => column.key),
      ['id', 'element_id', 'element', 'type', 'projet', 'date', 'heures', 'commentaire'],
    )
    const total = entries.body.rows.reduce((sum: number, row: any) => sum + row.heures, 0)
    assert.equal(Math.round(total * 100) / 100, 228)
    assert.ok(entries.body.rows.every((row: any) => /^\d{4}-\d{2}-\d{2}$/.test(row.date)))

    const milestones = await get('/api/exports/datasets/milestones')
    assert.equal(milestones.status, 200)
    assert.deepEqual(
      milestones.body.columns.map((column: any) => [column.key, column.type]),
      [
        ['id', 'number'],
        ['projet', 'string'],
        ['phase', 'string'],
        ['nom', 'string'],
        ['date', 'date'],
        ['atteint', 'boolean'],
      ],
    )
    assert.deepEqual(
      milestones.body.rows.map((row: any) => [row.nom, row.phase, row.date, row.atteint]),
      [
        ['API Prête', 'Socle Technique', '2026-10-15', true],
        ['Beta UI', 'Expérience UI', '2026-11-02', false],
        ['Mise en production v2', null, '2026-11-16', false],
      ],
    )
  })

  it('jeu inconnu → 400, projet inconnu → 404', async () => {
    assert.equal((await get('/api/exports/datasets/inconnu')).status, 400)
    assert.equal((await get('/api/exports/datasets/work-items?projectId=999')).status, 404)
  })
})
