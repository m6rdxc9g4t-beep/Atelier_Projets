// Suite Atelier §4.1 : import DataFlow v2.1.0 depuis Atelier Tab (aperçu, création, réimport, idempotence,
// statuts et synonymes, lignes sans titre, version de schéma, jeton, CORS des deux routes).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { FORMULA_ERROR_CODES, matchStatus, planAtelierTabImport, type DataflowEnvelope } from '../src/domain/atelier-tab.ts'
import { isSameOriginRequest, isSuiteOrigin } from '../src/http/suite-cors.ts'
import { assertImportToken } from '../src/services/atelier-tab-import.ts'
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

describe('erreurs de formule (liste fermée d’Atelier Tab)', () => {
  const plan = (computed: string) =>
    planAtelierTabImport(
      envelope((p) => {
        p.project.records = [{ row_index: 1, record_id: 'r1', values: { A: cell('Lot'), D: { raw: '=X', computed } } }]
      }),
    )

  it('ignore les 8 codes du moteur, avec avertissement', () => {
    assert.equal(FORMULA_ERROR_CODES.size, 8)
    for (const code of ['#REF!', '#DIV/0!', '#VALUE!', '#NAME?', '#NUM!', '#N/A', '#CYCLE!', '#ERROR!']) {
      const result = plan(code)
      assert.doesNotMatch(result.items[0]!.description, new RegExp(code.replace(/[/?!]/g, '\\$&')), code)
      assert.ok(result.warnings.some((warning) => warning.includes(`erreur de formule ${code}`)), code)
    }
  })

  it('garde un texte qui ressemble à un code (« #URGENT! », « #TODO? »)', () => {
    for (const text of ['#URGENT!', '#TODO?', '#A1!', '#REF', '#N/A!']) {
      const result = plan(text)
      assert.ok(result.items[0]!.description.includes(text), text)
      assert.ok(!result.warnings.some((warning) => warning.includes('erreur de formule')), text)
    }
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

  it('CORS : preflight accepté pour 127.0.0.1 et localhost, refusé ailleurs ; reste de l’API sans CORS', async () => {
    for (const origin of ['http://127.0.0.1:5175', 'http://localhost:4175']) {
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

    // Depuis Atelier Tab dans le navigateur (autre port local).
    const browser = await post('/api/imports/atelier-tab/preview', envelope(), { origin: 'http://127.0.0.1:5175' })
    assert.equal(browser.statusCode, 200)
    assert.equal(browser.headers['access-control-allow-origin'], 'http://127.0.0.1:5175')
    // Relais de l'app de bureau Tab (processus principal) : aucun en-tête Origin, appel local ordinaire.
    const relay = await post('/api/imports/atelier-tab/preview', envelope())
    assert.equal(relay.statusCode, 200)
    assert.equal(relay.headers['access-control-allow-origin'], undefined)
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
    assert.equal(isSuiteOrigin('null'), false)
  })

  it('origine « null » refusée sur les routes d’import (iframe sandbox, data:, fichier local)', async () => {
    const before = await ctx.prisma.workItem.count()
    const preflight = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/api/imports/atelier-tab',
      headers: { origin: 'null', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    })
    for (const name of ['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers']) {
      assert.equal(preflight.headers[name], undefined, name)
    }
    for (const url of ['/api/imports/atelier-tab', '/api/imports/atelier-tab/preview', `/api/imports/atelier-tab/preview?projectId=${projectId}`]) {
      const response = await post(url, envelope((p) => (p.project.source_table = { id: 'tbl_null', name: 'Null' })), { origin: 'null' })
      assert.equal(response.statusCode, 403, url)
      assert.equal(response.json().code, 'FORBIDDEN_ORIGIN')
      assert.equal(response.headers['access-control-allow-origin'], undefined, 'réponse illisible par la page')
    }
    assert.equal(await ctx.prisma.workItem.count(), before)
  })
})

describe('jeton ATELIER_IMPORT_TOKEN', () => {
  let ctx: TestContext
  before(async () => {
    ctx = await createTestContext({ importToken: 'secret-local' })
  })
  after(() => ctx.close())

  const send = (headers: Record<string, string>, url = '/api/imports/atelier-tab/preview') =>
    ctx.app.inject({ method: 'POST', url, payload: envelope(), headers })

  it('exige Authorization: Bearer <jeton> des appels externes', async () => {
    // Appel sans Origin (webhook, relais de l'app de bureau Tab, curl) sans jeton : refusé.
    const noOrigin = await send({})
    assert.equal(noOrigin.statusCode, 401)
    assert.equal(noOrigin.json().code, 'UNAUTHORIZED')
    // Atelier Tab dans le navigateur (autre origine locale) : refusé, erreur lisible.
    const missing = await send({ origin: 'http://127.0.0.1:5175' })
    assert.equal(missing.statusCode, 401)
    assert.equal(missing.headers['access-control-allow-origin'], 'http://127.0.0.1:5175', 'erreur lisible par l’appelant')
    // Même hôte, autre port (Host 127.0.0.1:3000, Origin 127.0.0.1:5175) : pas « même origine ».
    assert.equal((await send({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:5175' })).statusCode, 401)
    assert.equal((await send({ authorization: 'Bearer autre' })).statusCode, 401)
    assert.equal((await send({ authorization: 'Bearer secret-loca' })).statusCode, 401, 'préfixe du jeton')
    assert.equal((await send({ authorization: 'Bearer secret-local-plus' })).statusCode, 401, 'jeton plus long')
    assert.equal((await send({ authorization: 'secret-local' })).statusCode, 401, 'sans « Bearer »')
    assert.equal((await send({ authorization: 'Bearer secret-local' })).statusCode, 200)
    const browser = await send({ origin: 'http://127.0.0.1:5175', authorization: 'Bearer secret-local' })
    assert.equal(browser.statusCode, 200)
    const imported = await ctx.app.inject({
      method: 'POST',
      url: '/api/imports/atelier-tab',
      payload: envelope(),
      headers: { authorization: 'bearer secret-local' },
    })
    assert.equal(imported.statusCode, 200)
    assert.equal(imported.json().created, 3)
  })

  it('n’est pas exigé de l’interface de Projets (même origine, y compris via le relais /api de Vite)', async () => {
    for (const [host, origin] of [
      ['127.0.0.1:5174', 'http://127.0.0.1:5174'], // npm run dev (relais Vite, Host conservé)
      ['localhost:4174', 'http://localhost:4174'], // aperçu
      ['127.0.0.1:3000', 'http://127.0.0.1:3000'],
      ['127.0.0.1:80', 'http://127.0.0.1'], // port par défaut implicite
    ] as const) {
      const preview = await send({ host, origin })
      assert.equal(preview.statusCode, 200, `${origin} → ${preview.body}`)
    }
    const imported = await send({ host: '127.0.0.1:5174', origin: 'http://127.0.0.1:5174' }, '/api/imports/atelier-tab')
    assert.equal(imported.statusCode, 200, imported.body)
  })

  it('est vérifié avant la lecture du corps', async () => {
    // Corps illisible : sans jeton, 401 (et non 400) — le corps n'a pas été analysé.
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/imports/atelier-tab',
      payload: '{ pas du JSON',
      headers: { 'content-type': 'application/json' },
    })
    assert.equal(response.statusCode, 401)
    const valid = await ctx.app.inject({
      method: 'POST',
      url: '/api/imports/atelier-tab',
      payload: '{ pas du JSON',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret-local' },
    })
    assert.equal(valid.statusCode, 400, 'avec le jeton, le corps est ensuite analysé')
    // Preflight CORS : jamais de jeton (le navigateur n'envoie pas Authorization).
    const preflight = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/api/imports/atelier-tab',
      headers: { origin: 'http://127.0.0.1:5175', 'access-control-request-method': 'POST' },
    })
    assert.equal(preflight.statusCode, 204)
  })

  it('isSameOriginRequest : Origin = schéma + Host exacts', () => {
    const same = (host: string | undefined, origin: string | undefined) => isSameOriginRequest({ headers: { host, origin } } as any)
    assert.equal(same('127.0.0.1:5174', 'http://127.0.0.1:5174'), true)
    assert.equal(same('LOCALHOST:4174', 'http://localhost:4174'), true)
    assert.equal(same('127.0.0.1', 'http://127.0.0.1:80'.replace(':80', '')), true)
    assert.equal(same('[::1]:3000', 'http://[::1]:3000'), true)
    assert.equal(same('127.0.0.1:3000', undefined), false, 'sans Origin : appel externe')
    assert.equal(same('127.0.0.1:3000', 'null'), false)
    assert.equal(same('127.0.0.1:3000', 'http://127.0.0.1:5175'), false)
    assert.equal(same('127.0.0.1:3000', 'http://localhost:3000'), false)
    assert.equal(same('127.0.0.1:3000', 'file://'), false)
    assert.equal(same('127.0.0.1:3000', 'http://127.0.0.1:3000/chemin'), false)
    assert.equal(same(undefined, 'http://127.0.0.1:3000'), false)
    assert.equal(same('127.0.0.1:3000@evil.example', 'http://evil.example'), false)
  })

  it('assertImportToken : comparaison d’empreintes, quelle que soit la longueur', () => {
    assert.doesNotThrow(() => assertImportToken(undefined, undefined))
    assert.doesNotThrow(() => assertImportToken('abc', 'Bearer abc'))
    for (const given of [undefined, '', 'Bearer ', 'Bearer ab', 'Bearer abcd', 'Bearer ' + 'x'.repeat(10_000)]) {
      assert.throws(() => assertImportToken('abc', given), (error: any) => error.statusCode === 401, String(given?.length))
    }
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

describe('réimport après renommage (projet, story ou table)', () => {
  let ctx: TestContext
  let projectId: number
  let storyId: number
  before(async () => {
    ctx = await createTestContext({ now: () => NOW })
    const first = await ctx.app.inject({ method: 'POST', url: '/api/imports/atelier-tab', payload: envelope() })
    assert.equal(first.statusCode, 200, first.body)
    ;({ projectId, storyId } = first.json())
  })
  after(() => ctx.close())

  const post = (url: string, payload: unknown) => ctx.app.inject({ method: 'POST', url, payload: payload as object })
  const containers = async () =>
    Promise.all([ctx.prisma.project.count(), ctx.prisma.phase.count(), ctx.prisma.epic.count(), ctx.prisma.story.count()])

  it('projet et story renommés, rien de nouveau : aucun conteneur créé, réponse sur les éléments existants', async () => {
    await ctx.prisma.project.update({ where: { id: projectId }, data: { name: 'Rénovation (renommé)' } })
    await ctx.prisma.story.update({ where: { id: storyId }, data: { title: 'Lots (renommé)' } })
    const before = await containers()

    const preview = await post('/api/imports/atelier-tab/preview', envelope())
    assert.equal(preview.statusCode, 200, preview.body)
    const planned = preview.json()
    assert.deepEqual([planned.projectId, planned.storyId, planned.created], [projectId, storyId, 0])
    assert.deepEqual(planned.target.project, { id: projectId, name: 'Rénovation (renommé)', exists: true })
    assert.deepEqual(planned.target.story, { title: 'Lots (renommé)', exists: true })

    const response = await post('/api/imports/atelier-tab', envelope())
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.deepEqual([body.projectId, body.storyId, body.created], [projectId, storyId, 0])
    assert.ok(!body.warnings.some((warning: string) => /autre projet|rangés/.test(warning)), body.warnings.join('\n'))
    assert.deepEqual(await containers(), before, 'ni projet, ni phase, ni epic, ni story vides')
  })

  it('table renommée (même id) : les éléments restent dans leur story', async () => {
    const before = await containers()
    const renamed = envelope((p) => (p.project.source_table.name = 'Planning v2'))
    const body = (await post('/api/imports/atelier-tab', renamed)).json()
    assert.deepEqual([body.projectId, body.storyId, body.created], [projectId, storyId, 0])
    assert.deepEqual(await containers(), before)
  })

  it('nouvelle ligne d’une table déjà importée dont le projet a été renommé : rangée avec les autres', async () => {
    const before = await containers()
    const payload = envelope((p) => {
      p.project.source_table.name = 'Planning v2'
      p.project.records.push({ row_index: 4, record_id: 'rec_04', values: { A: cell('Menuiseries'), B: cell('Nouveau') } })
    })
    const preview = (await post('/api/imports/atelier-tab/preview', payload)).json()
    assert.deepEqual([preview.projectId, preview.storyId, preview.created], [projectId, storyId, 1])
    assert.equal(preview.target.story.exists, true)

    const response = await post('/api/imports/atelier-tab', payload)
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.deepEqual([body.projectId, body.storyId, body.created], [projectId, storyId, 1])
    assert.ok(
      body.warnings.includes(
        'Nouveaux éléments rangés avec ceux déjà importés de cette table : Rénovation (renommé) › Imports Atelier Tab › Espace Architecture › Lots (renommé).',
      ),
      body.warnings.join('\n'),
    )
    const created = await ctx.prisma.workItem.findUniqueOrThrow({ where: { externalRef: 'atelier-tab:tbl_planning_lots:rec_04' } })
    assert.deepEqual([created.projectId, created.storyId], [projectId, storyId])
    assert.deepEqual(await containers(), before, 'pas de projet « Rénovation Urbaine 2026 » recréé')
  })

  it('éléments déplacés dans une autre story : les nouveaux les rejoignent (story majoritaire)', async () => {
    const epic = await ctx.prisma.story.findUniqueOrThrow({ where: { id: storyId }, select: { epicId: true } })
    const other = await ctx.prisma.story.create({ data: { epicId: epic.epicId, title: 'Rangement manuel', position: 99 } })
    await ctx.prisma.workItem.updateMany({ where: { storyId }, data: { storyId: other.id } })
    const payload = envelope((p) => {
      p.project.records.push({ row_index: 5, record_id: 'rec_05', values: { A: cell('Peinture') } })
    })
    const body = (await post('/api/imports/atelier-tab', payload)).json()
    assert.deepEqual([body.storyId, body.created], [other.id, 1])
    const created = await ctx.prisma.workItem.findUniqueOrThrow({ where: { externalRef: 'atelier-tab:tbl_planning_lots:rec_05' } })
    assert.equal(created.storyId, other.id)
  })

  it('projectId vers un autre projet, tout existe ailleurs : aucun conteneur créé, avertissements de déplacement', async () => {
    const target = await ctx.prisma.project.create({ data: { name: 'Autre', slug: 'autre' } })
    const before = await containers()
    const payload = envelope((p) => {
      p.project.records.push({ row_index: 4, record_id: 'rec_04', values: { A: cell('Menuiseries'), B: cell('Nouveau') } })
      p.project.records.push({ row_index: 5, record_id: 'rec_05', values: { A: cell('Peinture') } })
    })
    const response = await post(`/api/imports/atelier-tab?projectId=${target.id}`, payload)
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.deepEqual([body.projectId, body.storyId, body.created], [target.id, null, 0])
    assert.equal(body.warnings.filter((warning: string) => warning.includes('existe déjà dans un autre projet')).length, 5)
    assert.deepEqual(await containers(), before)
    assert.equal(await ctx.prisma.phase.count({ where: { projectId: target.id } }), 0)
  })
})

describe('rôles item_type et time_spent (export OpenProject passé par Tab)', () => {
  let ctx: TestContext
  before(async () => {
    ctx = await createTestContext({ now: () => NOW })
  })
  after(() => ctx.close())

  const post = (payload: unknown) => ctx.app.inject({ method: 'POST', url: '/api/imports/atelier-tab', payload: payload as object })
  const lots = (spent: (number | null)[], types = ['Feature', 'Bug', 'Story']) =>
    envelope((p) => {
      p.project.source_table = { id: 'tbl_lots', name: 'Lots de travaux' }
      p.project.columns_schema = [
        { col_letter: 'A', id: 'sujet', label: 'Sujet', type: 'text', atelier_mapping: 'entity_title' },
        { col_letter: 'B', id: 'type', label: 'Type', type: 'select', atelier_mapping: 'item_type' },
        { col_letter: 'C', id: 'temps', label: 'Temps passé', type: 'number', atelier_mapping: 'time_spent' },
        { col_letter: 'D', id: 'fin', label: 'Date de fin', type: 'date', atelier_mapping: 'due_date' },
      ]
      p.project.records = ['Colonne calculée', 'Sélecteur cassé', 'Afficher les trigrammes'].map((title, i) => ({
        row_index: i + 1,
        record_id: `r${i + 1}`,
        values: { A: cell(title), B: cell(types[i]!), C: cell(spent[i]!), D: cell(i === 2 ? null : '2026-02-10') },
      }))
    })
  const imported = () =>
    ctx.prisma.workItem.findMany({
      where: { externalRef: { startsWith: 'atelier-tab:tbl_lots:' } },
      orderBy: { externalRef: 'asc' },
      select: { type: true, timeEntries: { select: { hours: true, spentOn: true, comment: true } } },
    })

  it('crée les éléments avec leur type et une saisie de temps datée de l’échéance (sinon du jour)', async () => {
    const response = await post(lots([3.37, 0.25, 79]))
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().created, 3)
    const items = await imported()
    assert.deepEqual(
      items.map((item) => [item.type, item.timeEntries.map((t) => [t.hours, t.spentOn.toISOString().slice(0, 10), t.comment])]),
      [
        ['FEATURE', [[3.37, '2026-02-10', 'Import Atelier Tab']]],
        ['BUG', [[0.25, '2026-02-10', 'Import Atelier Tab']]],
        ['TASK', [[79, '2026-10-19', 'Import Atelier Tab']]],
      ],
    )
  })

  it('réimport identique : rien ne change, aucune saisie en double', async () => {
    const body = (await post(lots([3.37, 0.25, 79]))).json()
    assert.deepEqual([body.created, body.updated, body.unchanged], [0, 0, 3])
    assert.equal(await ctx.prisma.timeEntry.count(), 3)
  })

  it('réimport modifié : la saisie importée suit le fichier, les temps saisis à la main restent', async () => {
    const [first] = await ctx.prisma.workItem.findMany({ where: { externalRef: 'atelier-tab:tbl_lots:r1' } })
    await ctx.prisma.timeEntry.create({ data: { workItemId: first!.id, spentOn: new Date('2026-02-11'), hours: 1, comment: 'à la main' } })
    const body = (await post(lots([4, null, 79], ['Task', 'Bug', 'Story']))).json()
    assert.deepEqual([body.updated, body.unchanged], [2, 1])
    const items = await imported()
    assert.equal(items[0]!.type, 'TASK')
    assert.deepEqual(items[0]!.timeEntries.map((t) => [t.hours, t.comment]).sort(), [[1, 'à la main'], [4, 'Import Atelier Tab']])
    assert.deepEqual(items[1]!.timeEntries, [], 'temps retiré du fichier : saisie importée retirée')
  })
})
