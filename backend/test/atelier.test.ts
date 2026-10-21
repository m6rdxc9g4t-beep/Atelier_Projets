// Nœud Atelier (docs/SUITE.md §7, atelier-node/1) : manifeste, tables atelier-table/1, événements (chaque type,
// persistance du seq, gap, rétention), idempotence des actions « header » et erreurs { detail, code }.
import assert from 'node:assert/strict'
import { mkdtemp, readFileSync, rm } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import { promisify } from 'node:util'
import { Ajv2020 } from 'ajv/dist/2020.js'
import ajvFormats from 'ajv-formats'
import { buildApp } from '../src/app.ts'
import { createPrismaClient } from '../src/db/client.ts'
import { snakeKeys, snakeSchema, toSnakeKey } from '../src/domain/snake-case.ts'
import { EVENT_KEEP_COUNT, EVENT_KEEP_MS, emitEvents, nodeEvent, purgeEvents } from '../src/services/atelier-events.ts'
import { NODE_ACTIONS } from '../src/services/atelier-manifest.ts'
import { EVENT_DATA_SCHEMAS } from '../src/schemas/atelier.ts'
import { applyMigrations, createTestContext, type TestContext } from './helpers/test-app.ts'

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/atelier-tab-planning.json', import.meta.url), 'utf8'))
const ACTION_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
const NOW = new Date('2026-10-21T10:00:00Z')
const addFormats = ajvFormats.default

let ctx: TestContext
before(async () => {
  ctx = await createTestContext({ seed: true, now: () => NOW })
})
after(() => ctx.close())

interface Res<T = any> {
  status: number
  body: T
  headers: Record<string, unknown>
}

async function req<T = any>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT', url: string, payload?: unknown, headers?: Record<string, string>): Promise<Res<T>> {
  const response = await ctx.app.inject({ method, url, ...(payload !== undefined && { payload: payload as object }), ...(headers && { headers }) })
  return { status: response.statusCode, body: (response.body === '' ? undefined : response.json()) as T, headers: response.headers }
}

/** Dernier seq du journal (0 s'il est vide). */
async function lastSeq(): Promise<number> {
  return (await ctx.prisma.atelierEvent.findFirst({ orderBy: { seq: 'desc' } }))?.seq ?? 0
}

/** Événements émis depuis `since` (exclusif), lus par la route. */
async function eventsSince(since: number): Promise<any[]> {
  const { status, body } = await req('GET', `/api/atelier/events?since=${since}&limit=500`)
  assert.equal(status, 200)
  return body.events
}

/** Contrôle qu'un événement respecte le data_schema déclaré dans le manifeste. */
function assertEventData(event: any): void {
  const schema = (EVENT_DATA_SCHEMAS as Record<string, unknown>)[event.type]
  assert.ok(schema, `type déclaré : ${event.type}`)
  const ajv = new Ajv2020({ strict: false })
  addFormats(ajv)
  const validate = ajv.compile(JSON.parse(JSON.stringify(schema)))
  assert.ok(validate(event.data), `${event.type} : ${JSON.stringify(validate.errors)}`)
  assert.equal(typeof event.subject.id, 'string')
  assert.ok(typeof event.at === 'string' && !Number.isNaN(Date.parse(event.at)))
}

async function demoStoryId(): Promise<number> {
  return (await ctx.prisma.story.findFirstOrThrow({ where: { epic: { phase: { projectId: ctx.demoProjectId } } }, orderBy: { id: 'asc' } })).id
}

// --- snake_case -----------------------------------------------------------------------------------

describe('conversion snake_case', () => {
  it('convertit les clés et garde les valeurs d’énumération en majuscules', () => {
    assert.equal(toSnakeKey('hoursPerDay'), 'hours_per_day')
    assert.equal(toSnakeKey('IN_PROGRESS'), 'IN_PROGRESS')
    assert.equal(toSnakeKey('already_snake'), 'already_snake')
    assert.deepEqual(snakeKeys({ storyId: 1, statusCounts: { IN_PROGRESS: 2 }, list: [{ startDate: null }] }), {
      story_id: 1,
      status_counts: { IN_PROGRESS: 2 },
      list: [{ start_date: null }],
    })
    assert.deepEqual(snakeSchema({ type: 'object', properties: { dueDate: { anyOf: [{ type: 'object', properties: { spentOn: {} }, required: ['spentOn'] }] } }, required: ['dueDate'] }), {
      type: 'object',
      properties: { due_date: { anyOf: [{ type: 'object', properties: { spent_on: {} }, required: ['spent_on'] }] } },
      required: ['due_date'],
    })
  })
})

// --- Manifeste ------------------------------------------------------------------------------------

describe('GET /api/atelier/manifest', () => {
  it('respecte le contrat : app, transport, id uniques et conformes, un seul transport, schémas valides', async () => {
    const { status, body } = await req('GET', '/api/atelier/manifest')
    assert.equal(status, 200)
    assert.equal(body.contract, 'atelier-node/1')
    assert.equal(body.app, 'projets')
    assert.equal(body.transport, 'http')
    assert.equal(body.name, 'Atelier Projets')
    assert.match(body.version, /^\d+\.\d+\.\d+/)

    const ids = body.actions.map((action: any) => action.id)
    assert.equal(new Set(ids).size, ids.length, 'identifiants uniques')
    assert.deepEqual(ids, [
      'projects.list',
      'projects.tree',
      'work_items.list',
      'work_items.get',
      'work_items.create',
      'work_items.update',
      'work_items.log',
      'time_entries.create',
      'milestones.list',
      'milestones.reach',
      'tables.get',
      'imports.atelier_tab',
    ])
    const ajv = new Ajv2020({ strict: false })
    addFormats(ajv)
    for (const action of body.actions) {
      assert.match(action.id, ACTION_ID, action.id)
      assert.ok(['read', 'write', 'destructive'].includes(action.kind), action.id)
      assert.ok(['header', 'field', 'natural', 'none'].includes(action.idempotency), action.id)
      assert.ok(action.http && action.mcp_tool === null, `${action.id} : exactement un transport (http)`)
      assert.match(action.http.path, /^\/api\//)
      assert.ok(action.label.length > 0 && action.description.length > 0, action.id)
      assert.equal(action.input_schema.type, 'object', action.id)
      assert.ok(['atelier-table/1', 'json'].includes(action.output.format), action.id)
      ajv.compile(action.input_schema)
      ajv.compile(action.output.schema)
      // Propriétés en snake_case ; paramètres du chemin déclarés et obligatoires.
      for (const key of Object.keys(action.input_schema.properties ?? {})) assert.match(key, /^[a-z][a-z0-9_]*$/, `${action.id}.${key}`)
      for (const [, name] of action.http.path.matchAll(/\{([a-z_]+)\}/g)) {
        assert.ok(action.input_schema.properties[name], `${action.id} : ${name} dans input_schema`)
        assert.ok(action.input_schema.required.includes(name), `${action.id} : ${name} obligatoire`)
      }
      if (action.kind === 'read') assert.equal(action.http.method, 'GET', action.id)
      // Toute écriture qui crée accepte une clé (§7.4).
      if (['work_items.create', 'work_items.log', 'time_entries.create', 'imports.atelier_tab'].includes(action.id)) {
        assert.equal(action.idempotency, 'header', action.id)
      }
    }
    // Aucune action ne touche au mode en ligne (§5.1 / §7).
    assert.ok(!JSON.stringify(body).toLowerCase().includes('online'))
    assert.ok(body.actions.every((action: any) => !action.http.path.includes('/settings')))

    assert.deepEqual(
      body.events.map((event: any) => event.type),
      [
        'projets.work_item.created',
        'projets.work_item.updated',
        'projets.work_item.status_changed',
        'projets.work_item.deleted',
        'projets.time_entry.created',
        'projets.milestone.reached',
        'projets.import.completed',
      ],
    )
    for (const event of body.events) {
      assert.ok(event.label.length > 0)
      ajv.compile(event.data_schema)
    }
  })

  it('décrit les paramètres de work_items.list et l’entrée de work_items.create en snake_case', async () => {
    const { body } = await req('GET', '/api/atelier/manifest')
    const list = body.actions.find((action: any) => action.id === 'work_items.list')
    assert.deepEqual(Object.keys(list.input_schema.properties).sort(), ['project_id', 'q', 'status', 'story_id', 'type', 'updated_since'])
    assert.equal(list.output.format, 'atelier-table/1')
    const create = body.actions.find((action: any) => action.id === 'work_items.create')
    assert.deepEqual(create.http, { method: 'POST', path: '/api/atelier/stories/{story_id}/work-items' })
    assert.deepEqual(create.input_schema.required.sort(), ['story_id', 'title', 'type'])
    assert.ok(create.input_schema.properties.estimated_hours)
    assert.equal(create.input_schema.additionalProperties, false)
    assert.ok(create.output.schema.properties.project_id, 'sortie en snake_case')
    const imports = body.actions.find((action: any) => action.id === 'imports.atelier_tab')
    assert.deepEqual(imports.http, { method: 'POST', path: '/api/imports/atelier-tab' })
    assert.equal(imports.input_schema.type, 'object')
  })

  it('chaque action /api/atelier déclarée a une route (pas de 404)', async () => {
    for (const action of NODE_ACTIONS) {
      const url = action.path.replace(/\{[a-z_]+\}/g, '999999').replace('{name}', 'work-items')
      const response = await ctx.app.inject({ method: action.method, url, ...(action.method !== 'GET' && { payload: {} }) })
      assert.notEqual(response.json().code, 'ROUTE_NOT_FOUND', action.id)
    }
  })
})

// --- Tables atelier-table/1 ---------------------------------------------------------------------

function assertAtelierTable(table: any, name: string): void {
  assert.equal(table.format, 'atelier-table/1')
  assert.equal(table.name, name)
  assert.ok(table.label.length > 0)
  const keys = table.columns.map((column: any) => column.key)
  assert.equal(new Set(keys).size, keys.length)
  for (const column of table.columns) {
    assert.match(column.key, /^[a-z][a-z0-9_]*$/)
    assert.ok(['string', 'number', 'date', 'datetime', 'boolean'].includes(column.type))
  }
  for (const row of table.rows) assert.deepEqual(Object.keys(row).sort(), [...keys].sort())
  assert.equal(table.total, table.rows.length)
  assert.equal(table.truncated, false)
}

describe('tables atelier-table/1', () => {
  it('tables.get : les trois jeux de §4.3, mêmes colonnes et lignes que /api/exports/datasets', async () => {
    for (const name of ['work-items', 'time-entries', 'milestones']) {
      const table = await req('GET', `/api/atelier/tables/${name}?project_id=${ctx.demoProjectId}`)
      assert.equal(table.status, 200)
      assertAtelierTable(table.body, name)
      const dataset = await req('GET', `/api/exports/datasets/${name}?projectId=${ctx.demoProjectId}`)
      assert.deepEqual(table.body.columns, dataset.body.columns)
      assert.deepEqual(table.body.rows, dataset.body.rows)
    }
    const unknown = await req('GET', '/api/atelier/tables/inconnue')
    assert.equal(unknown.status, 400)
    assert.equal(unknown.body.code, 'VALIDATION')
    const missing = await req('GET', '/api/atelier/tables/milestones?project_id=999999')
    assert.equal(missing.status, 404)
    assert.deepEqual(Object.keys(missing.body).sort(), ['code', 'detail'])
  })

  it('work_items.list : colonnes du jeu work-items, filtres statut, type, story, recherche', async () => {
    const all = await req('GET', `/api/atelier/projects/${ctx.demoProjectId}/work-items`)
    assertAtelierTable(all.body, 'work-items')
    const dataset = await req('GET', `/api/exports/datasets/work-items?projectId=${ctx.demoProjectId}`)
    assert.deepEqual(all.body.columns, dataset.body.columns)
    assert.equal(all.body.rows.length, dataset.body.rows.length)

    const progress = await req('GET', `/api/atelier/projects/${ctx.demoProjectId}/work-items?status=IN_PROGRESS&status=IN_REVIEW`)
    assert.ok(progress.body.rows.length > 0)
    assert.ok(progress.body.rows.every((row: any) => ['IN_PROGRESS', 'IN_REVIEW'].includes(row.statut_code)))
    const bugs = await req('GET', `/api/atelier/projects/${ctx.demoProjectId}/work-items?type=BUG`)
    assert.ok(bugs.body.rows.every((row: any) => row.type === 'BUG'))
    const storyId = await demoStoryId()
    const story = await ctx.prisma.story.findUniqueOrThrow({ where: { id: storyId } })
    const byStory = await req('GET', `/api/atelier/projects/${ctx.demoProjectId}/work-items?story_id=${storyId}`)
    assert.ok(byStory.body.rows.length > 0 && byStory.body.rows.every((row: any) => row.story === story.title))
    const byId = await req('GET', `/api/atelier/projects/${ctx.demoProjectId}/work-items?q=%23101`)
    assert.deepEqual(byId.body.rows.map((row: any) => row.id), [101])
  })

  it('work_items.list : updated_since ne garde que les éléments modifiés depuis', async () => {
    const before = new Date(Date.now() - 1000).toISOString()
    await ctx.prisma.workItem.update({ where: { id: 102 }, data: { title: 'Titre retouché' } })
    const recent = await req('GET', `/api/atelier/projects/${ctx.demoProjectId}/work-items?updated_since=${encodeURIComponent(before)}`)
    assert.equal(recent.status, 200)
    assert.ok(recent.body.rows.some((row: any) => row.id === 102))
    assert.ok(recent.body.rows.every((row: any) => Date.parse(row.maj_le) >= Date.parse(before)))
    const future = await req('GET', `/api/atelier/projects/${ctx.demoProjectId}/work-items?updated_since=2999-01-01T00:00:00Z`)
    assert.deepEqual(future.body.rows, [])
    const invalid = await req('GET', `/api/atelier/projects/${ctx.demoProjectId}/work-items?updated_since=hier`)
    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.code, 'VALIDATION')
  })

  it('milestones.list : jalons d’un projet en atelier-table/1', async () => {
    const { status, body } = await req('GET', `/api/atelier/projects/${ctx.demoProjectId}/milestones`)
    assert.equal(status, 200)
    assertAtelierTable(body, 'milestones')
    assert.equal(body.rows.length, await ctx.prisma.milestone.count({ where: { projectId: ctx.demoProjectId } }))
  })
})

// --- Lectures JSON --------------------------------------------------------------------------------

describe('lectures JSON en snake_case', () => {
  it('projects.list, projects.tree, work_items.get', async () => {
    const projects = await req('GET', '/api/atelier/projects')
    assert.equal(projects.status, 200)
    assert.ok(projects.body.some((project: any) => project.id === ctx.demoProjectId && 'hours_per_day' in project))
    const tree = await req('GET', `/api/atelier/projects/${ctx.demoProjectId}/tree`)
    assert.equal(tree.status, 200)
    assert.ok(Array.isArray(tree.body.phases) && 'critical_path' in tree.body && 'hours_per_day' in tree.body)
    assert.ok('status_counts' in tree.body.aggregate && 'IN_PROGRESS' in tree.body.aggregate.status_counts)
    const item = await req('GET', '/api/atelier/work-items/101')
    assert.equal(item.status, 200)
    assert.equal(item.body.id, 101)
    assert.ok('implementation_log' in item.body && 'time_entries' in item.body)
    assert.ok(!JSON.stringify(Object.keys(item.body)).match(/[A-Z]/), 'clés de premier niveau en snake_case')
  })
})

// --- Erreurs --------------------------------------------------------------------------------------

describe('erreurs { detail, code } (§7.5)', () => {
  it('404, validation, champ inconnu, route inconnue, gardes Host et Origin', async () => {
    const notFound = await req('GET', '/api/atelier/work-items/999999')
    assert.deepEqual(notFound.body, { detail: 'Élément #999999 introuvable', code: 'NOT_FOUND' })
    const validation = await req('POST', `/api/atelier/stories/${await demoStoryId()}/work-items`, { type: 'TASK' })
    assert.equal(validation.status, 400)
    assert.equal(validation.body.code, 'VALIDATION')
    const unknownField = await req('PATCH', '/api/atelier/work-items/101', { onlineMode: true })
    assert.equal(unknownField.status, 400)
    assert.equal(unknownField.body.code, 'VALIDATION')
    const route = await req('GET', '/api/atelier/inconnue')
    assert.deepEqual(Object.keys(route.body).sort(), ['code', 'detail'])
    assert.equal(route.body.code, 'NOT_FOUND')

    const host = await ctx.app.inject({ method: 'GET', url: '/api/atelier/manifest', headers: { host: 'evil.example' } })
    assert.equal(host.statusCode, 403)
    assert.deepEqual(host.json().code, 'FORBIDDEN_HOST')
    assert.ok(typeof host.json().detail === 'string')
    const origin = await ctx.app.inject({ method: 'PATCH', url: '/api/atelier/work-items/101', headers: { origin: 'https://evil.example' }, payload: { title: 'x' } })
    assert.equal(origin.statusCode, 403)
    assert.equal(origin.json().code, 'FORBIDDEN_ORIGIN')
    assert.notEqual((await ctx.prisma.workItem.findUniqueOrThrow({ where: { id: 101 } })).title, 'x')
  })

  it('les routes existantes gardent leur format d’erreur', async () => {
    const legacy = await req('GET', '/api/work-items/999999')
    assert.deepEqual(Object.keys(legacy.body).sort(), ['code', 'error', 'message', 'statusCode'])
  })

  it('aucune action ne change le mode en ligne', async () => {
    const before = await req('GET', '/api/settings')
    for (const action of NODE_ACTIONS) assert.ok(!action.path.includes('settings'), action.id)
    const after = await req('GET', '/api/settings')
    assert.deepEqual(after.body, before.body)
    assert.equal(after.body.onlineMode, false)
  })
})

// --- Événements -----------------------------------------------------------------------------------

describe('événements émis par les services', () => {
  it('work_item.created (création directe)', async () => {
    const since = await lastSeq()
    const created = await req('POST', `/api/atelier/stories/${await demoStoryId()}/work-items`, { type: 'BUG', title: 'Bug du nœud', priority: 'HIGH', estimated_hours: 2, due_date: '2026-11-02' })
    assert.equal(created.status, 201)
    assert.equal(created.body.title, 'Bug du nœud')
    assert.equal(created.body.estimate.hours, 2)
    assert.equal(created.body.due_date, '2026-11-02')
    const events = await eventsSince(since)
    assert.deepEqual(events.map((event) => event.type), ['projets.work_item.created'])
    const [event] = events
    assertEventData(event)
    assert.deepEqual(event.subject, { kind: 'work_item', id: String(created.body.id), label: 'Bug du nœud' })
    assert.deepEqual(event.data, { project_id: String(ctx.demoProjectId), story_id: String(created.body.story_id), type: 'BUG', status: 'OPEN' })
    assert.equal(event.at, NOW.toISOString())
  })

  it('work_item.created par lot (route batch existante) : un événement par élément, dans l’ordre', async () => {
    const since = await lastSeq()
    const storyId = await demoStoryId()
    const batch = await req('POST', `/api/stories/${storyId}/work-items/batch`, { items: [{ type: 'TASK', title: 'Lot A' }, { type: 'FEATURE', title: 'Lot B' }] })
    assert.equal(batch.status, 201)
    const events = await eventsSince(since)
    assert.deepEqual(events.map((event) => [event.type, event.subject.label]), [
      ['projets.work_item.created', 'Lot A'],
      ['projets.work_item.created', 'Lot B'],
    ])
    events.forEach(assertEventData)
    // Lot refusé (tout ou rien) : aucun événement.
    const before = await lastSeq()
    const refused = await req('POST', `/api/stories/${storyId}/work-items/batch`, { items: [{ type: 'TASK', title: 'Ok' }, { type: 'TASK', title: 'Ko', startDate: '2026-12-02', dueDate: '2026-12-01' }] })
    assert.equal(refused.status, 400)
    assert.equal(await lastSeq(), before)
  })

  it('status_changed + updated sur un changement de statut ; updated seul sinon ; rien sans changement', async () => {
    const since = await lastSeq()
    const item = await ctx.prisma.workItem.findUniqueOrThrow({ where: { id: 103 } })
    const target = item.status === 'BLOCKED' ? 'IN_REVIEW' : 'BLOCKED'
    const changed = await req('PATCH', '/api/atelier/work-items/103', { status: target })
    assert.equal(changed.status, 200)
    assert.equal(changed.body.status, target)
    let events = await eventsSince(since)
    assert.deepEqual(events.map((event) => event.type), ['projets.work_item.status_changed', 'projets.work_item.updated'])
    events.forEach(assertEventData)
    assert.deepEqual(events[0].data, { project_id: String(ctx.demoProjectId), from: item.status, to: target })
    assert.ok(events[1].data.fields.includes('status'))

    const second = await lastSeq()
    await req('PATCH', '/api/atelier/work-items/103', { priority: 'IMMEDIATE', due_date: '2026-12-24' })
    events = await eventsSince(second)
    assert.deepEqual(events.map((event) => event.type), ['projets.work_item.updated'])
    assert.deepEqual([...events[0].data.fields].sort(), ['due_date', 'priority'])

    // Idempotence naturelle : rejouer la même modification ne change rien et n'émet rien.
    const third = await lastSeq()
    const replay = await req('PATCH', '/api/atelier/work-items/103', { priority: 'IMMEDIATE', due_date: '2026-12-24' })
    assert.equal(replay.status, 200)
    assert.equal(replay.body.priority, 'IMMEDIATE')
    assert.equal(await lastSeq(), third)

    // Route existante (camelCase) : mêmes événements, émis par le service.
    const fourth = await lastSeq()
    await req('PATCH', '/api/work-items/103', { status: 'CLOSED' })
    events = await eventsSince(fourth)
    assert.deepEqual(events.map((event) => event.type), ['projets.work_item.status_changed', 'projets.work_item.updated'])
    assert.ok(events[1].data.fields.includes('progress'), 'CLOSED ⇒ avancement à 100 %')

    const empty = await req('PATCH', '/api/atelier/work-items/103', {})
    assert.equal(empty.status, 400)
    assert.equal(empty.body.code, 'VALIDATION')
  })

  it('work_item.deleted : suppression directe et en cascade (story)', async () => {
    const storyId = await demoStoryId()
    const a = await req('POST', `/api/atelier/stories/${storyId}/work-items`, { type: 'TASK', title: 'À supprimer' })
    const since = await lastSeq()
    assert.equal((await req('DELETE', `/api/work-items/${a.body.id}`)).status, 204)
    let events = await eventsSince(since)
    assert.deepEqual(events.map((event) => [event.type, event.subject.id]), [['projets.work_item.deleted', String(a.body.id)]])
    assertEventData(events[0])

    const epic = await ctx.prisma.epic.findFirstOrThrow({ where: { phase: { projectId: ctx.demoProjectId } } })
    const story = await req('POST', `/api/epics/${epic.id}/stories`, { title: 'Story jetable' })
    await req('POST', `/api/stories/${story.body.id}/work-items/batch`, { items: [{ type: 'TASK', title: 'X' }, { type: 'TASK', title: 'Y' }] })
    const cascade = await lastSeq()
    assert.equal((await req('DELETE', `/api/stories/${story.body.id}`)).status, 204)
    events = await eventsSince(cascade)
    assert.deepEqual(events.map((event) => [event.type, event.subject.label]), [
      ['projets.work_item.deleted', 'X'],
      ['projets.work_item.deleted', 'Y'],
    ])
  })

  it('time_entry.created : saisie et arrêt du chronomètre', async () => {
    const since = await lastSeq()
    const entry = await req('POST', '/api/atelier/work-items/101/time-entries', { hours: 1.5, spent_on: '2026-10-20', comment: 'Revue' })
    assert.equal(entry.status, 201)
    assert.equal(entry.body.spent_on, '2026-10-20')
    assert.equal(entry.body.duration.hours, 1.5)
    let events = await eventsSince(since)
    assert.deepEqual(events.map((event) => event.type), ['projets.time_entry.created'])
    assertEventData(events[0])
    assert.deepEqual(events[0].data, { project_id: String(ctx.demoProjectId), time_entry_id: String(entry.body.id), hours: 1.5, spent_on: '2026-10-20' })
    assert.equal(events[0].subject.kind, 'work_item')

    // Chronomètre : horloge propre (démarrage puis arrêt 30 min plus tard).
    let clock = new Date('2026-10-21T08:00:00Z')
    const timed = await createTestContext({ seed: true, now: () => clock })
    try {
      assert.equal((await timed.app.inject({ method: 'POST', url: '/api/timer/start', payload: { workItemId: 102 } })).statusCode, 200)
      clock = new Date('2026-10-21T08:30:00Z')
      // Démarrer ailleurs arrête et saisit le chronomètre en cours.
      assert.equal((await timed.app.inject({ method: 'POST', url: '/api/timer/start', payload: { workItemId: 103 } })).statusCode, 200)
      clock = new Date('2026-10-21T09:00:00Z')
      assert.equal((await timed.app.inject({ method: 'POST', url: '/api/timer/stop', payload: {} })).statusCode, 200)
      const page = (await timed.app.inject({ method: 'GET', url: '/api/atelier/events?since=0' })).json()
      assert.deepEqual(page.events.map((event: any) => [event.type, event.subject.id, event.data.hours]), [
        ['projets.time_entry.created', '102', 0.5],
        ['projets.time_entry.created', '103', 0.5],
      ])
      page.events.forEach(assertEventData)
    } finally {
      await timed.close()
    }
  })

  it('work_item.updated pour une entrée de journal ; milestone.reached une seule fois', async () => {
    const since = await lastSeq()
    const log = await req('POST', '/api/atelier/work-items/101/log-entries', { text: 'Déployé en recette', hours: 2 })
    assert.equal(log.status, 201)
    assert.equal(log.body.work_item_id, 101)
    assert.match(log.body.entry, /^> \*\*21 Oct 2026 - 12h00 \(2h passées\) :\*\* Déployé en recette$/)
    let events = await eventsSince(since)
    assert.deepEqual(events.map((event) => [event.type, event.data.fields]), [['projets.work_item.updated', ['implementation_log']]])

    const milestone = await ctx.prisma.milestone.create({
      data: { projectId: ctx.demoProjectId, title: 'Livraison nœud', date: new Date('2026-10-30T00:00:00Z') },
    })
    const reachSince = await lastSeq()
    const reached = await req('POST', `/api/atelier/milestones/${milestone.id}/reach`, {})
    assert.equal(reached.status, 200)
    assert.equal(reached.body.reached, true)
    assert.equal(reached.body.reached_at, NOW.toISOString())
    events = await eventsSince(reachSince)
    assert.deepEqual(events.map((event) => event.type), ['projets.milestone.reached'])
    assertEventData(events[0])
    assert.deepEqual(events[0].subject, { kind: 'milestone', id: String(milestone.id), label: 'Livraison nœud' })
    assert.deepEqual(events[0].data, { project_id: String(ctx.demoProjectId), date: '2026-10-30', reached_at: NOW.toISOString() })

    // Rejouer (idempotence naturelle) : même état, date conservée, aucun nouvel événement.
    const again = await req('POST', `/api/atelier/milestones/${milestone.id}/reach`, { reached_at: '2026-10-01T00:00:00Z' })
    assert.equal(again.body.reached_at, NOW.toISOString())
    assert.equal(await lastSeq(), reachSince + 1)

    // Route existante : reachedAt posé par PATCH ; date future refusée.
    const other = await ctx.prisma.milestone.create({ data: { projectId: ctx.demoProjectId, title: 'Autre jalon', date: new Date('2026-11-30T00:00:00Z') } })
    const patchSince = await lastSeq()
    await req('PATCH', `/api/milestones/${other.id}`, { reachedAt: '2026-10-20T12:00:00Z' })
    assert.deepEqual((await eventsSince(patchSince)).map((event) => event.type), ['projets.milestone.reached'])
    const future = await req('POST', `/api/atelier/milestones/${milestone.id + 1000}/reach`, {})
    assert.equal(future.status, 404)
  })

  it('import.completed : un seul événement par import, aucun au rejeu', async () => {
    const since = await lastSeq()
    const headers = { 'idempotency-key': 'nexus:run-1:step-import', 'x-atelier-schema-version': '2.1.0' }
    const first = await req('POST', '/api/imports/atelier-tab', FIXTURE, headers)
    assert.equal(first.status, 200, JSON.stringify(first.body))
    const events = await eventsSince(since)
    assert.deepEqual(events.map((event) => event.type), ['projets.import.completed'])
    assertEventData(events[0])
    assert.deepEqual(events[0].subject, { kind: 'project', id: String(first.body.projectId), label: 'Rénovation Urbaine 2026' })
    assert.deepEqual(events[0].data, { source: 'atelier-tab', created: first.body.created, updated: 0, unchanged: 0, skipped: first.body.skipped })
    assert.ok(first.body.created > 0)

    const replay = await req('POST', '/api/imports/atelier-tab', FIXTURE, headers)
    assert.equal(replay.headers['idempotency-replayed'], 'true')
    assert.equal(await lastSeq(), since + 1, 'rejeu : aucun événement')
    // Réimport (autre clé) : nouvel événement, éléments inchangés.
    await req('POST', '/api/imports/atelier-tab', FIXTURE, { 'idempotency-key': 'autre' })
    const [reimport] = await eventsSince(since + 1)
    assert.equal(reimport.data.unchanged, first.body.created)
    assert.equal(reimport.data.created, 0)
  })

  it('data ne contient que des identifiants, statuts et nombres (jamais de description ni de journal)', async () => {
    const all = await eventsSince(0)
    assert.ok(all.length > 5)
    const text = JSON.stringify(all.map((event) => event.data))
    assert.ok(!text.includes('Déployé en recette'))
    assert.ok(!text.includes('Revue'))
  })
})

// --- Lecture des événements -----------------------------------------------------------------------

describe('GET /api/atelier/events', () => {
  let local: TestContext
  beforeEach(async () => {
    await local?.close()
    local = await createTestContext({ now: () => NOW })
  })
  after(() => local?.close())

  const page = async (query: string) => (await local.app.inject({ method: 'GET', url: `/api/atelier/events${query}` })).json()
  const emit = (n: number, at = NOW) =>
    emitEvents(
      local.prisma,
      Array.from({ length: n }, (_, i) => nodeEvent('projets.work_item.deleted', { kind: 'work_item', id: String(i + 1), label: `#${i + 1}` }, { project_id: '1' })),
      at,
    )

  it('journal vide : next = since (ou 0), oldest = 1, pas de trou', async () => {
    assert.deepEqual(await page(''), { events: [], next: 0, oldest: 1, gap: false })
    assert.deepEqual(await page('?since=0'), { events: [], next: 0, oldest: 1, gap: false })
  })

  it('since exclusif, limit, types, plus récents sans since', async () => {
    await emit(5)
    await emitEvents(local.prisma, [nodeEvent('projets.import.completed', { kind: 'project', id: '1', label: 'P' }, { source: 'atelier-tab', created: 1, updated: 0, unchanged: 0, skipped: 0 })], NOW)
    const after2 = await page('?since=2&limit=2')
    assert.deepEqual(after2.events.map((event: any) => event.seq), [3, 4])
    assert.equal(after2.next, 4)
    assert.equal(after2.oldest, 1)
    assert.equal(after2.gap, false)
    const latest = await page('?limit=2')
    assert.deepEqual(latest.events.map((event: any) => event.seq), [5, 6], 'les plus récents, dans l’ordre croissant')
    const typed = await page('?since=0&types=projets.import.completed,projets.milestone.reached')
    assert.deepEqual(typed.events.map((event: any) => event.type), ['projets.import.completed'])
    const end = await page('?since=6')
    assert.deepEqual([end.events, end.next], [[], 6])
    const tooMany = await local.app.inject({ method: 'GET', url: '/api/atelier/events?limit=501' })
    assert.equal(tooMany.statusCode, 400)
    assert.equal(tooMany.json().code, 'VALIDATION')
  })

  it('rétention : garde les 1 000 derniers ou 30 jours, gap quand des événements sont perdus', async () => {
    const old = new Date(NOW.getTime() - EVENT_KEEP_MS - 3600_000)
    await emit(EVENT_KEEP_COUNT + 10, old)
    assert.equal(await local.prisma.atelierEvent.count(), EVENT_KEEP_COUNT + 10, 'émis il y a 31 jours : rien n’était encore périmé')
    // Aujourd'hui, tous ont plus de 30 jours : seuls les 1 000 derniers restent.
    assert.equal(await purgeEvents(local.prisma, NOW), 10)
    assert.equal(await local.prisma.atelierEvent.count(), EVENT_KEEP_COUNT)
    const oldest = (await page('?since=0&limit=1')).oldest
    assert.equal(oldest, 11)
    assert.equal((await page('?since=9')).gap, true, 'since < oldest − 1')
    assert.equal((await page('?since=10')).gap, false, 'since = oldest − 1 : rien de perdu')
    // Récents (moins de 30 jours) : jamais purgés, même au-delà de 1 000.
    await emit(EVENT_KEEP_COUNT + 5, NOW)
    assert.equal(await local.prisma.atelierEvent.count(), EVENT_KEEP_COUNT + 5)
    assert.equal(await purgeEvents(local.prisma, NOW), 0)
  })

  it('base remplacée (since au-delà du dernier seq) : gap', async () => {
    await emit(3)
    assert.equal((await page('?since=50')).gap, true)
  })
})

describe('persistance du seq', () => {
  it('seq strictement croissant, jamais réutilisé après purge ni redémarrage', async () => {
    const dir = await promisify(mkdtemp)(path.join(tmpdir(), 'atelier-events-'))
    const file = path.join(dir, 'events.db')
    await applyMigrations(file)
    const open = async () => {
      const prisma = createPrismaClient(`file:${file}`)
      return { prisma, app: await buildApp({ prisma, logger: false, timeZone: 'UTC', now: () => NOW }) }
    }
    const event = (id: string) => nodeEvent('projets.work_item.deleted', { kind: 'work_item', id, label: id }, { project_id: '1' })
    try {
      const first = await open()
      await emitEvents(first.prisma, [event('a'), event('b'), event('c')], NOW)
      await first.prisma.atelierEvent.deleteMany({ where: { seq: 3 } })
      await first.app.close()

      const second = await open()
      await emitEvents(second.prisma, [event('d')], NOW)
      const body = (await second.app.inject({ method: 'GET', url: '/api/atelier/events?since=0' })).json()
      assert.deepEqual(body.events.map((e: any) => [e.seq, e.subject.id]), [
        [1, 'a'],
        [2, 'b'],
        [4, 'd'],
      ])
      await second.app.close()
    } finally {
      await promisify(rm)(dir, { recursive: true, force: true })
    }
  })
})

// --- Idempotence des actions « header » ---------------------------------------------------------

describe('idempotence (Idempotency-Key, §7.4)', () => {
  const cases: Array<{ id: string; url: () => Promise<string>; body: unknown; other: unknown; count: () => Promise<number> }> = [
    {
      id: 'work_items.create',
      url: async () => `/api/atelier/stories/${await demoStoryId()}/work-items`,
      body: { type: 'TASK', title: 'Idempotent' },
      other: { type: 'TASK', title: 'Autre contenu' },
      count: () => ctx.prisma.workItem.count(),
    },
    {
      id: 'work_items.log',
      url: async () => '/api/atelier/work-items/104/log-entries',
      body: { text: 'Entrée idempotente' },
      other: { text: 'Autre entrée' },
      count: async () => ((await ctx.prisma.workItem.findUniqueOrThrow({ where: { id: 104 } })).implementationLog.match(/^> \*\*/gm) ?? []).length,
    },
    {
      id: 'time_entries.create',
      url: async () => '/api/atelier/work-items/104/time-entries',
      body: { hours: 0.25 },
      other: { hours: 0.5 },
      count: () => ctx.prisma.timeEntry.count(),
    },
    {
      id: 'imports.atelier_tab',
      url: async () => `/api/imports/atelier-tab?projectId=${ctx.demoProjectId}`,
      body: FIXTURE,
      other: { ...FIXTURE, project: { ...FIXTURE.project, records: FIXTURE.project.records.slice(0, 1) } },
      count: () => ctx.prisma.workItem.count(),
    },
  ]

  for (const test of cases) {
    it(`${test.id} : rejeu identique sans nouvelle écriture ni événement, autre contenu → 409`, async () => {
      const url = await test.url()
      const key = `nexus:run-7:${test.id}`
      const first = await req('POST', url, test.body, { 'idempotency-key': key })
      assert.ok(first.status === 201 || first.status === 200, JSON.stringify(first.body))
      assert.equal(first.headers['idempotency-replayed'], undefined)
      const count = await test.count()
      const seq = await lastSeq()

      const replay = await req('POST', url, test.body, { 'idempotency-key': key })
      assert.equal(replay.status, first.status)
      assert.equal(replay.headers['idempotency-replayed'], 'true')
      assert.deepEqual(replay.body, first.body)
      assert.equal(await test.count(), count, 'aucune écriture')
      assert.equal(await lastSeq(), seq, 'aucun événement')

      const reused = await req('POST', url, test.other, { 'idempotency-key': key })
      assert.equal(reused.status, 409)
      assert.equal(reused.body.code, 'IDEMPOTENCY_KEY_REUSED')
      assert.equal(await test.count(), count)

      // Sans clé : écriture ordinaire (deux appels, deux écritures) — sauf l'import, idempotent par externalRef.
      if (test.id !== 'imports.atelier_tab') {
        await req('POST', url, test.body)
        await req('POST', url, test.body)
        assert.equal(await test.count(), count + 2)
      }
    })
  }

  it('portée par action : la même clé sert à deux actions différentes', async () => {
    const key = 'nexus:run-8:partagee'
    const a = await req('POST', '/api/atelier/work-items/104/time-entries', { hours: 1 }, { 'idempotency-key': key })
    const b = await req('POST', '/api/atelier/work-items/104/log-entries', { text: 'Même clé, autre action' }, { 'idempotency-key': key })
    assert.equal(a.status, 201)
    assert.equal(b.status, 201)
    assert.equal(b.headers['idempotency-replayed'], undefined)
  })

  it('même clé, même corps, autre chemin → 409 ; clé trop longue → 400', async () => {
    const key = 'nexus:run-9:chemin'
    assert.equal((await req('POST', '/api/atelier/work-items/104/time-entries', { hours: 1 }, { 'idempotency-key': key })).status, 201)
    const other = await req('POST', '/api/atelier/work-items/105/time-entries', { hours: 1 }, { 'idempotency-key': key })
    assert.equal(other.status, 409)
    const long = await req('POST', '/api/atelier/work-items/104/time-entries', { hours: 1 }, { 'idempotency-key': 'x'.repeat(201) })
    assert.equal(long.status, 400)
    assert.equal(long.body.code, 'VALIDATION')
  })

  it('une écriture en erreur n’enregistre pas la clé (nouvelle tentative possible)', async () => {
    const key = 'nexus:run-10:erreur'
    const failed = await req('POST', '/api/atelier/work-items/999999/time-entries', { hours: 1 }, { 'idempotency-key': key })
    assert.equal(failed.status, 404)
    assert.equal(await ctx.prisma.idempotencyRecord.count({ where: { key } }), 0)
  })

  it('les clés sont conservées 30 jours puis purgées', async () => {
    await ctx.prisma.idempotencyRecord.create({
      data: { scope: 'work_items.log', key: 'ancienne', requestHash: 'x', statusCode: 201, response: '{}', createdAt: new Date(NOW.getTime() - 31 * 24 * 3600_000) },
    })
    await req('POST', '/api/atelier/work-items/104/time-entries', { hours: 1 }, { 'idempotency-key': 'nouvelle-purge' })
    assert.equal(await ctx.prisma.idempotencyRecord.count({ where: { key: 'ancienne' } }), 0)
  })
})

describe('migration 20261021120000_atelier_node', () => {
  it('reprend les clés ImportIdempotency existantes dans la portée imports.atelier_tab', async () => {
    const { readdir, readFile } = await import('node:fs/promises')
    const Database = (await import('better-sqlite3')).default
    const dir = await promisify(mkdtemp)(path.join(tmpdir(), 'atelier-migration-'))
    const file = path.join(dir, 'm.db')
    const migrationsDir = path.join(import.meta.dirname, '..', 'prisma', 'migrations')
    const names = (await readdir(migrationsDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    const db = new Database(file)
    try {
      for (const name of names) {
        if (name === '20261021120000_atelier_node') {
          db.prepare(`INSERT INTO "ImportIdempotency" ("key", "requestHash", "statusCode", "response") VALUES ('envoi-1', 'h', 200, '{"created":1}')`).run()
        }
        db.exec(await readFile(path.join(migrationsDir, name, 'migration.sql'), 'utf8'))
      }
      const rows = db.prepare('SELECT scope, key, statusCode, response FROM "IdempotencyRecord"').all()
      assert.deepEqual(rows, [{ scope: 'imports.atelier_tab', key: 'envoi-1', statusCode: 200, response: '{"created":1}' }])
      assert.equal(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'ImportIdempotency'`).get(), undefined)
    } finally {
      db.close()
      await promisify(rm)(dir, { recursive: true, force: true })
    }
  })
})
