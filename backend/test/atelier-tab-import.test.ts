// Suite Atelier §4.1 : import DataFlow v2.1.0 depuis Atelier Tab (aperçu, création, réimport, idempotence,
// statuts et synonymes, lignes sans titre, version de schéma, jeton, CORS des deux routes).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { matchStatus, planAtelierTabImport, type DataflowEnvelope } from '../src/domain/atelier-tab.ts'
import { isSuiteOrigin } from '../src/http/suite-cors.ts'
import { createTestContext, type TestContext } from './helpers/test-app.ts'

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/atelier-tab-planning.json', import.meta.url), 'utf8')) as DataflowEnvelope
const NOW = new Date('2026-10-19T10:00:00Z')

/** Copie modifiable de l'enveloppe d'exemple. */
function envelope(change?: (payload: any) => void): any {
  const payload = structuredClone(FIXTURE)
  change?.(payload)
  return payload
}

function cell(text: string | number | boolean | null) {
  return { raw: text === null ? '' : String(text), computed: text }
}

describe('correspondance des statuts (SUITE.md §1.4)', () => {
  it('accepte codes, libellés et synonymes, sans tenir compte de la casse ni des accents', () => {
    assert.equal(matchStatus('IN_PROGRESS'), 'IN_PROGRESS')
    assert.equal(matchStatus('in progress'), 'IN_PROGRESS')
    assert.equal(matchStatus('En cours'), 'IN_PROGRESS')
    assert.equal(matchStatus('a faire'), 'OPEN')
    assert.equal(matchStatus('À FAIRE'), 'OPEN')
    assert.equal(matchStatus('terminee'), 'CLOSED')
    assert.equal(matchStatus('Bloquée'), 'BLOCKED')
    for (const [text, status] of [
      ['Ouvert', 'OPEN'],
      ['nouveau', 'OPEN'],
      ['Fait', 'CLOSED'],
      ['TERMINÉ', 'CLOSED'],
      ['clos', 'CLOSED'],
      ['bloque', 'BLOCKED'],
      ['Résolu', 'RESOLVED'],
      ['rejete', 'REJECTED'],
      ['Annulé', 'REJECTED'],
    ] as const) {
      assert.equal(matchStatus(text), status, text)
    }
    assert.equal(matchStatus('Validé'), null)
  })

  it('construit titre, statut, dates et tableau « Données Atelier Tab »', () => {
    const plan = planAtelierTabImport(FIXTURE)
    assert.equal(plan.projectName, 'Rénovation Urbaine 2026')
    assert.equal(plan.epicTitle, 'Espace Architecture')
    assert.equal(plan.storyTitle, 'Planning & Lots')
    assert.deepEqual(
      plan.items.map(({ externalRef, title, status, dueDate }) => [externalRef, title, status, dueDate]),
      [
        ['atelier-tab:tbl_planning_lots:rec_01', 'Gros œuvre', 'IN_PROGRESS', '2026-11-30'],
        ['atelier-tab:tbl_planning_lots:rec_02', 'Charpente bois', 'OPEN', '2026-12-15'],
        ['atelier-tab:tbl_planning_lots:rec_03', 'Isolation thermique', 'OPEN', '2027-01-20'],
      ],
    )
    const description = plan.items[0]!.description
    assert.match(description, /### Données Atelier Tab/)
    assert.match(description, /\| Coût HT \| 45 000 \|/)
    assert.match(description, /\| Coût TTC \| 54 000 \|/)
    assert.match(description, /\| Responsable \| Marie Dubois \|/)
    assert.doesNotMatch(description, /Échéance/, 'la colonne due_date sert de date, pas de donnée')
    assert.deepEqual(plan.warnings, ['Ligne 2 : statut « Validé » inconnu, « À faire » retenu.'])
  })
})

describe('POST /api/imports/atelier-tab', () => {
  let ctx: TestContext
  before(async () => {
    ctx = await createTestContext({ now: () => NOW })
  })
  after(() => ctx.close())

  const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method: 'POST', url, payload: payload as object, headers })

  it('aperçu : décrit l’import sans rien écrire', async () => {
    const response = await post('/api/imports/atelier-tab/preview', envelope())
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.deepEqual(body.target, {
      project: { id: null, name: 'Rénovation Urbaine 2026', exists: false },
      phase: { title: 'Imports Atelier Tab', exists: false },
      epic: { title: 'Espace Architecture', exists: false },
      story: { title: 'Planning & Lots', exists: false },
      type: 'TASK',
    })
    assert.deepEqual([body.created, body.updated, body.unchanged, body.skipped], [3, 0, 0, 0])
    assert.equal(body.projectId, null)
    assert.equal(await ctx.prisma.project.count(), 0)
    assert.equal(await ctx.prisma.workItem.count(), 0)
  })

  let projectId: number
  let storyId: number

  it('crée projet, phase, epic, story et éléments', async () => {
    const response = await post('/api/imports/atelier-tab', envelope())
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.deepEqual([body.created, body.updated, body.skipped], [3, 0, 0])
    assert.equal(body.warnings.length, 1)
    projectId = body.projectId
    storyId = body.storyId
    assert.deepEqual(
      body.items.map((item: any) => [item.recordId, item.action]),
      [
        ['rec_01', 'created'],
        ['rec_02', 'created'],
        ['rec_03', 'created'],
      ],
    )
    const story = await ctx.prisma.story.findUniqueOrThrow({ where: { id: storyId }, include: { epic: { include: { phase: { include: { project: true } } } } } })
    assert.equal(story.title, 'Planning & Lots')
    assert.equal(story.epic.title, 'Espace Architecture')
    assert.equal(story.epic.phase.title, 'Imports Atelier Tab')
    assert.equal(story.epic.phase.project.name, 'Rénovation Urbaine 2026')

    const items = await ctx.prisma.workItem.findMany({ where: { storyId }, orderBy: { position: 'asc' } })
    assert.deepEqual(
      items.map((item) => [item.title, item.type, item.status, item.dueDate?.toISOString().slice(0, 10), item.externalRef]),
      [
        ['Gros œuvre', 'TASK', 'IN_PROGRESS', '2026-11-30', 'atelier-tab:tbl_planning_lots:rec_01'],
        ['Charpente bois', 'TASK', 'OPEN', '2026-12-15', 'atelier-tab:tbl_planning_lots:rec_02'],
        ['Isolation thermique', 'TASK', 'OPEN', '2027-01-20', 'atelier-tab:tbl_planning_lots:rec_03'],
      ],
    )
    // L'élément est visible dans l'API habituelle (fiche, Gantt).
    const detail = await ctx.app.inject({ method: 'GET', url: `/api/work-items/${items[0]!.id}` })
    assert.equal(detail.statusCode, 200)
    assert.match(detail.json().description, /Données Atelier Tab/)
  })

  it('réimport : met à jour les éléments existants au lieu d’en créer', async () => {
    const changed = envelope((payload) => {
      payload.project.records[1].values.B = cell('Terminé')
      payload.project.records[0].values.A = cell('Gros œuvre (lot 1)')
    })
    const response = await post('/api/imports/atelier-tab', changed)
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.equal(body.projectId, projectId)
    assert.equal(body.storyId, storyId)
    assert.deepEqual(
      body.items.map((item: any) => [item.recordId, item.action]),
      [
        ['rec_01', 'updated'],
        ['rec_02', 'updated'],
        ['rec_03', 'unchanged'],
      ],
    )
    assert.equal(await ctx.prisma.workItem.count(), 3)
    assert.equal(await ctx.prisma.project.count(), 1)
    assert.equal(await ctx.prisma.phase.count(), 1)
    const closed = await ctx.prisma.workItem.findUniqueOrThrow({ where: { externalRef: 'atelier-tab:tbl_planning_lots:rec_02' } })
    assert.equal(closed.status, 'CLOSED')
    assert.equal(closed.progress, 100, 'Terminée ⇒ 100 %')
  })

  it('Idempotency-Key : une clé rejouée renvoie la même réponse sans réimporter', async () => {
    const payload = envelope((p) => {
      p.project.records.push({ row_index: 4, record_id: 'rec_04', values: { A: cell('Menuiseries'), B: cell('Nouveau') } })
    })
    const headers = { 'idempotency-key': 'envoi-42', 'x-atelier-schema-version': '2.1.0' }
    const first = await post('/api/imports/atelier-tab', payload, headers)
    assert.equal(first.statusCode, 200, first.body)
    assert.equal(first.json().created, 1)
    assert.equal(first.headers['idempotency-replayed'], undefined)

    // Entre-temps l'élément est modifié dans Atelier Projets : le rejeu ne doit pas l'écraser.
    const created = await ctx.prisma.workItem.findUniqueOrThrow({ where: { externalRef: 'atelier-tab:tbl_planning_lots:rec_04' } })
    assert.equal(created.status, 'OPEN')
    await ctx.prisma.workItem.update({ where: { id: created.id }, data: { title: 'Menuiseries extérieures' } })

    const replay = await post('/api/imports/atelier-tab', payload, headers)
    assert.equal(replay.statusCode, 200)
    assert.equal(replay.headers['idempotency-replayed'], 'true')
    assert.deepEqual(replay.json(), first.json())
    assert.equal((await ctx.prisma.workItem.findUniqueOrThrow({ where: { id: created.id } })).title, 'Menuiseries extérieures')
    assert.equal(await ctx.prisma.workItem.count(), 4)

    // Même clé, autre contenu : refusé.
    const reused = await post('/api/imports/atelier-tab', envelope(), headers)
    assert.equal(reused.statusCode, 409)
    assert.equal(reused.json().code, 'IDEMPOTENCY_KEY_REUSED')
  })

  it('ignore une ligne sans titre (avertissement) et signale statut inconnu et erreurs de formule', async () => {
    const payload = envelope((p) => {
      p.project.source_table = { id: 'tbl_divers', name: 'Divers' }
      p.project.records = [
        { row_index: 1, record_id: 'r1', values: { A: cell('  '), B: cell('En cours') } },
        { row_index: 2, record_id: 'r2', values: { A: cell('Ravalement'), B: cell('Peut-être'), D: { raw: '=C2/0', computed: '#DIV/0!' } } },
        { row_index: 3, record_id: 'r3', values: { A: cell('Toiture'), B: cell('annulé'), F: cell('30/11/2026') } },
      ]
    })
    const response = await post(`/api/imports/atelier-tab?projectId=${projectId}&type=BUG`, payload)
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.equal(body.projectId, projectId)
    assert.deepEqual([body.created, body.skipped], [2, 1])
    assert.deepEqual(body.items[0], {
      recordId: 'r1',
      rowIndex: 1,
      workItemId: null,
      action: 'skipped',
      title: null,
      status: null,
      startDate: null,
      dueDate: null,
      reason: 'titre vide',
    })
    assert.ok(body.warnings.includes('Ligne 1 ignorée : titre vide.'))
    assert.ok(body.warnings.includes('Ligne 2 : statut « Peut-être » inconnu, « À faire » retenu.'))
    assert.ok(body.warnings.some((warning: string) => warning.includes('#DIV/0!')))
    const [ravalement, toiture] = await Promise.all(
      ['r2', 'r3'].map((id) => ctx.prisma.workItem.findUniqueOrThrow({ where: { externalRef: `atelier-tab:tbl_divers:${id}` } })),
    )
    assert.equal(ravalement!.status, 'OPEN')
    assert.equal(ravalement!.type, 'BUG')
    assert.equal(toiture!.status, 'REJECTED')
    assert.equal(toiture!.dueDate?.toISOString().slice(0, 10), '2026-11-30')
    // Même projet, même phase et même epic ; nouvelle story « Divers ».
    assert.equal(await ctx.prisma.phase.count({ where: { projectId } }), 1)
    assert.equal(await ctx.prisma.epic.count(), 1)
    assert.equal(await ctx.prisma.story.count(), 2)
  })

  it('refuse une autre version de schéma (422), un payload mal formé (400) et un projet inconnu (404)', async () => {
    const header = await post('/api/imports/atelier-tab', envelope(), { 'x-atelier-schema-version': '3.0.0' })
    assert.equal(header.statusCode, 422)
    assert.equal(header.json().code, 'UNSUPPORTED_SCHEMA_VERSION')
    const body = await post('/api/imports/atelier-tab/preview', envelope((p) => (p.schema_version = '2.0.0')))
    assert.equal(body.statusCode, 422)
    const target = await post('/api/imports/atelier-tab', envelope((p) => (p.target_system = 'autre')))
    assert.equal(target.statusCode, 400)
    const columns = await post('/api/imports/atelier-tab', envelope((p) => (p.project.columns_schema = [])))
    assert.equal(columns.statusCode, 400)
    const unknown = await post('/api/imports/atelier-tab?projectId=999', envelope())
    assert.equal(unknown.statusCode, 404)
  })

  it('CORS : preflight accepté pour 127.0.0.1, localhost et null, refusé ailleurs ; reste de l’API sans CORS', async () => {
    for (const origin of ['http://127.0.0.1:5175', 'http://localhost:4175', 'null']) {
      const response = await ctx.app.inject({
        method: 'OPTIONS',
        url: '/api/imports/atelier-tab',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type, idempotency-key, x-atelier-schema-version, authorization',
        },
      })
      assert.equal(response.statusCode, 204, origin)
      assert.equal(response.headers['access-control-allow-origin'], origin)
      assert.equal(response.headers['access-control-allow-methods'], 'POST, OPTIONS')
      assert.equal(response.headers['access-control-allow-headers'], 'Content-Type, Authorization, Idempotency-Key, X-Atelier-Schema-Version')
    }
    const foreign = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/api/imports/atelier-tab/preview',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    })
    assert.equal(foreign.headers['access-control-allow-origin'], undefined)

    // Requête réelle depuis l'app Electron (Origin: null) : acceptée et lisible.
    const electron = await post('/api/imports/atelier-tab/preview', envelope(), { origin: 'null' })
    assert.equal(electron.statusCode, 200)
    assert.equal(electron.headers['access-control-allow-origin'], 'null')
    // Depuis Atelier Tab dans le navigateur (autre port local).
    const browser = await post('/api/imports/atelier-tab/preview', envelope(), { origin: 'http://127.0.0.1:5175' })
    assert.equal(browser.statusCode, 200)
    assert.equal(browser.headers['access-control-allow-origin'], 'http://127.0.0.1:5175')
    // Un autre site reste refusé par le garde local.
    const evil = await post('/api/imports/atelier-tab', envelope(), { origin: 'https://evil.example' })
    assert.equal(evil.statusCode, 403)
    // Les autres routes n'ont pas de CORS, et l'origine null y reste refusée en écriture.
    const projects = await ctx.app.inject({ method: 'GET', url: '/api/projects', headers: { origin: 'http://127.0.0.1:5175' } })
    assert.equal(projects.headers['access-control-allow-origin'], undefined)
    const write = await ctx.app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'x' }, headers: { origin: 'null' } })
    assert.equal(write.statusCode, 403)

    assert.equal(isSuiteOrigin('http://127.0.0.1:3000'), true)
    assert.equal(isSuiteOrigin('https://127.0.0.1:3000'), false)
    assert.equal(isSuiteOrigin('http://127.0.0.1.evil.example'), false)
    assert.equal(isSuiteOrigin('http://localhost:5175/chemin'), false)
  })
})

describe('jeton ATELIER_IMPORT_TOKEN', () => {
  let ctx: TestContext
  before(async () => {
    ctx = await createTestContext({ importToken: 'secret-local' })
  })
  after(() => ctx.close())

  it('exige Authorization: Bearer <jeton> quand il est configuré', async () => {
    const send = (headers: Record<string, string>) =>
      ctx.app.inject({ method: 'POST', url: '/api/imports/atelier-tab/preview', payload: envelope(), headers })
    const missing = await send({ origin: 'http://127.0.0.1:5175' })
    assert.equal(missing.statusCode, 401)
    assert.equal(missing.json().code, 'UNAUTHORIZED')
    assert.equal(missing.headers['access-control-allow-origin'], 'http://127.0.0.1:5175', 'erreur lisible par l’appelant')
    assert.equal((await send({ authorization: 'Bearer autre' })).statusCode, 401)
    assert.equal((await send({ authorization: 'Bearer secret-local' })).statusCode, 200)
    const imported = await ctx.app.inject({
      method: 'POST',
      url: '/api/imports/atelier-tab',
      payload: envelope(),
      headers: { authorization: 'bearer secret-local' },
    })
    assert.equal(imported.statusCode, 200)
    assert.equal(imported.json().created, 3)
  })

  it('est ignoré quand aucun jeton n’est configuré', async () => {
    const open = await createTestContext()
    try {
      const response = await open.app.inject({
        method: 'POST',
        url: '/api/imports/atelier-tab/preview',
        payload: envelope(),
        headers: { authorization: 'Bearer peu-importe' },
      })
      assert.equal(response.statusCode, 200)
    } finally {
      await open.close()
    }
  })
})
