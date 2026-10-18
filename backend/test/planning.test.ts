// Gantt interactif (dépendances, décalages, replanification), chronomètre, export CSV et sauvegardes.
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import Database from 'better-sqlite3'
import { csvCell, toCsv } from '../src/domain/csv.ts'
import { criticalPath, dependencySlack, resolveConflicts, wouldCreateCycle } from '../src/domain/schedule.ts'
import { BackupManager } from '../src/services/backups.ts'
import { call, createTestContext, type TestContext } from './helpers/test-app.ts'

const span = (start: string, end: string) => ({ start, end })

describe('planification (module pur)', () => {
  it('calcule la marge d’une dépendance fin → début', () => {
    assert.equal(dependencySlack(span('2026-11-02', '2026-11-04'), span('2026-11-05', '2026-11-06')), 0)
    assert.equal(dependencySlack(span('2026-11-02', '2026-11-04'), span('2026-11-09', '2026-11-10')), 4)
    assert.equal(dependencySlack(span('2026-11-02', '2026-11-04'), span('2026-11-04', '2026-11-06')), -1)
    assert.equal(dependencySlack(null, span('2026-11-04', '2026-11-06')), null)
  })

  it('détecte les cycles', () => {
    const deps = [
      { predecessorId: 1, successorId: 2 },
      { predecessorId: 2, successorId: 3 },
    ]
    assert.equal(wouldCreateCycle(deps, 3, 1), true)
    assert.equal(wouldCreateCycle(deps, 1, 3), false)
    assert.equal(wouldCreateCycle(deps, 4, 4), true)
  })

  it('remonte le chemin critique depuis les éléments qui finissent le plus tard', () => {
    const spans = new Map([
      [1, span('2026-11-02', '2026-11-04')],
      [2, span('2026-11-05', '2026-11-10')],
      [3, span('2026-11-02', '2026-11-03')],
      [4, span('2026-11-06', '2026-11-08')],
      [5, null],
    ])
    const deps = [
      { predecessorId: 1, successorId: 2 },
      { predecessorId: 3, successorId: 4 },
      { predecessorId: 3, successorId: 2 },
    ]
    // 1 → 2 sans marge : critique ; 3 → 2 a une marge d'un jour.
    assert.deepEqual(criticalPath(spans, deps), [1, 2])
  })

  it('replanifie en cascade en conservant les durées', () => {
    const spans = new Map([
      [1, span('2026-11-02', '2026-11-06')],
      [2, span('2026-11-04', '2026-11-05')],
      [3, span('2026-11-05', '2026-11-09')],
      [4, span('2026-12-01', '2026-12-02')],
    ])
    const moved = resolveConflicts(spans, [
      { predecessorId: 1, successorId: 2 },
      { predecessorId: 2, successorId: 3 },
      { predecessorId: 1, successorId: 4 },
    ])
    assert.deepEqual(Object.fromEntries(moved), {
      2: span('2026-11-07', '2026-11-08'),
      3: span('2026-11-09', '2026-11-13'),
    })
  })
})

describe('CSV', () => {
  it('produit un CSV compatible Excel (BOM, « ; », virgule décimale, formules neutralisées)', () => {
    assert.equal(csvCell(1.5), '1,5')
    assert.equal(csvCell('a;b'), '"a;b"')
    assert.equal(csvCell('dit "oui"'), '"dit ""oui"""')
    assert.equal(csvCell('=SOMME(A1)'), "'=SOMME(A1)")
    assert.equal(csvCell(' \u00a0+1+1'), "' \u00a0+1+1")
    assert.equal(csvCell('Tâche - suite'), 'Tâche - suite')
    assert.equal(csvCell(null), '')
    assert.equal(toCsv(['A', 'B'], [[1, 'x']]), '﻿A;B\r\n1;x\r\n')
  })
})

describe('API de planification, chronomètre et export', () => {
  let ctx: TestContext
  let clock = new Date('2026-11-02T08:00:00Z')
  const api = <T = any>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    call<T>(ctx.app, method, url, payload)
  let projectId: number
  let phaseId: number
  let storyId: number
  const items: Record<string, number> = {}

  before(async () => {
    ctx = await createTestContext({ now: () => clock })
    projectId = (await api('POST', '/api/projects', { name: 'Planning' })).body.id
    phaseId = (await api('POST', `/api/projects/${projectId}/phases`, { title: 'Phase', startDate: '2026-11-02', dueDate: '2026-11-30' })).body.id
    const epicId = (await api('POST', `/api/phases/${phaseId}/epics`, { title: 'Epic' })).body.id
    storyId = (await api('POST', `/api/epics/${epicId}/stories`, { title: 'Story', startDate: '2026-11-02' })).body.id
    for (const [key, startDate, dueDate] of [
      ['a', '2026-11-02', '2026-11-06'],
      ['b', '2026-11-04', '2026-11-05'],
      ['c', '2026-11-09', '2026-11-10'],
    ] as const) {
      const res = await api('POST', `/api/stories/${storyId}/work-items`, { type: 'TASK', title: `Tâche ${key}`, startDate, dueDate, estimatedHours: 8 })
      assert.equal(res.status, 201, JSON.stringify(res.body))
      items[key] = res.body.id
    }
    await api('POST', `/api/projects/${projectId}/milestones`, { title: 'Recette', date: '2026-11-20', phaseId })
  })
  after(async () => {
    await ctx.close()
  })

  it('ajoute des dépendances et refuse doublons, cycles et autres projets', async () => {
    assert.equal((await api('POST', `/api/work-items/${items.b}/dependencies`, { predecessorId: items.a })).status, 204)
    assert.equal((await api('POST', `/api/work-items/${items.c}/dependencies`, { predecessorId: items.b })).status, 204)
    assert.equal((await api('POST', `/api/work-items/${items.b}/dependencies`, { predecessorId: items.a })).status, 409)
    const cycle = await api('POST', `/api/work-items/${items.a}/dependencies`, { predecessorId: items.c })
    assert.equal(cycle.status, 400)
    assert.match(cycle.body.message, /boucle/)
    assert.equal((await api('POST', `/api/work-items/${items.a}/dependencies`, { predecessorId: items.a })).status, 400)

    const other = (await api('POST', '/api/projects', { name: 'Autre' })).body.id
    const ph = (await api('POST', `/api/projects/${other}/phases`, { title: 'P' })).body.id
    const ep = (await api('POST', `/api/phases/${ph}/epics`, { title: 'E' })).body.id
    const st = (await api('POST', `/api/epics/${ep}/stories`, { title: 'S' })).body.id
    const foreign = (await api('POST', `/api/stories/${st}/work-items`, { type: 'TASK', title: 'Ailleurs' })).body.id
    assert.equal((await api('POST', `/api/work-items/${items.a}/dependencies`, { predecessorId: foreign })).status, 400)
  })

  it('expose dépendances, conflits et chemin critique dans l’arbre et la fiche', async () => {
    const tree = (await api('GET', `/api/projects/${projectId}/tree`)).body
    assert.deepEqual(tree.dependencies, [
      { predecessorId: items.a, successorId: items.b, slackDays: -3, conflict: true },
      { predecessorId: items.b, successorId: items.c, slackDays: 3, conflict: false },
    ])
    assert.deepEqual(tree.criticalPath, [items.c])

    const detail = (await api('GET', `/api/work-items/${items.b}`)).body
    assert.deepEqual(detail.predecessors.map((ref: any) => [ref.id, ref.slackDays]), [[items.a, -3]])
    assert.deepEqual(detail.successors.map((ref: any) => [ref.id, ref.slackDays]), [[items.c, 3]])
  })

  it('replanifie les conflits sans toucher aux marges positives', async () => {
    const { status, body } = await api('POST', `/api/projects/${projectId}/schedule/resolve`)
    assert.equal(status, 200)
    assert.deepEqual(body.moved, [{ id: items.b, startDate: '2026-11-07', dueDate: '2026-11-08' }])
    const tree = (await api('GET', `/api/projects/${projectId}/tree`)).body
    assert.equal(tree.dependencies.some((dependency: any) => dependency.conflict), false)
    assert.deepEqual(tree.criticalPath, [items.a, items.b, items.c])
    assert.deepEqual((await api('POST', `/api/projects/${projectId}/schedule/resolve`)).body.moved, [])
  })

  it('ne remplit pas les dates laissées vides en replanifiant', async () => {
    const lone = (await api('POST', `/api/stories/${storyId}/work-items`, { type: 'BUG', title: 'Échéance seule', dueDate: '2026-11-08' })).body
    assert.equal((await api('POST', `/api/work-items/${lone.id}/dependencies`, { predecessorId: items.c })).status, 204)
    const { body } = await api('POST', `/api/projects/${projectId}/schedule/resolve`)
    assert.deepEqual(body.moved, [{ id: lone.id, startDate: '2026-11-11', dueDate: '2026-11-11' }])
    const after = (await api('GET', `/api/work-items/${lone.id}`)).body
    assert.equal(after.startDate, null)
    assert.equal(after.dueDate, '2026-11-11')
    await api('DELETE', `/api/work-items/${lone.id}`)
  })

  it('supprime une dépendance', async () => {
    assert.equal((await api('DELETE', `/api/work-items/${items.c}/dependencies/${items.b}`)).status, 204)
    assert.equal((await api('DELETE', `/api/work-items/${items.c}/dependencies/${items.b}`)).status, 404)
  })

  it('décale une phase avec tout son contenu et ses jalons', async () => {
    const { status, body } = await api('POST', `/api/phases/${phaseId}/shift`, { days: 7 })
    assert.equal(status, 200, JSON.stringify(body))
    assert.deepEqual(body, { workItems: 3, containers: 2, milestones: 1 })
    const a = (await api('GET', `/api/work-items/${items.a}`)).body
    assert.equal(a.startDate, '2026-11-09')
    assert.equal(a.dueDate, '2026-11-13')
    const milestones = (await api('GET', `/api/projects/${projectId}/milestones`)).body
    assert.equal(milestones[0].date, '2026-11-27')
    assert.equal((await api('POST', `/api/stories/${storyId}/shift`, { days: 0 })).status, 400)
    assert.equal((await api('POST', `/api/epics/999999/shift`, { days: 1 })).status, 404)
  })

  it('chronomètre une tâche puis saisit le temps à l’arrêt', async () => {
    assert.deepEqual((await api('GET', '/api/timer')).body, { timer: null })
    assert.equal((await api('POST', '/api/timer/stop', {})).status, 400)

    const started = await api('POST', '/api/timer/start', { workItemId: items.a })
    assert.equal(started.status, 200, JSON.stringify(started.body))
    assert.equal(started.body.timer.workItemId, items.a)
    assert.equal(started.body.stopped, null)

    clock = new Date('2026-11-02T09:30:00Z')
    assert.equal((await api('GET', '/api/timer')).body.timer.elapsedSeconds, 5400)

    // Démarrer sur un autre élément arrête (et saisit) le précédent.
    const switched = await api('POST', '/api/timer/start', { workItemId: items.b })
    assert.equal(switched.body.stopped.workItemId, items.a)
    assert.equal(switched.body.stopped.timeEntry.duration.hours, 1.5)
    assert.equal(switched.body.stopped.timeEntry.comment, 'Chronomètre')

    clock = new Date('2026-11-02T09:50:00Z')
    const stopped = await api('POST', '/api/timer/stop', { comment: 'Revue de code' })
    assert.equal(stopped.status, 200)
    assert.equal(stopped.body.workItemId, items.b)
    assert.equal(stopped.body.timeEntry.duration.hours, 0.33)
    assert.equal(stopped.body.timeEntry.spentOn, '2026-11-02')
    assert.equal(stopped.body.capped, false)
    assert.deepEqual((await api('GET', '/api/timer')).body, { timer: null })

    // Deux démarrages simultanés : un seul chronomètre, aucune erreur.
    const both = await Promise.all([
      api('POST', '/api/timer/start', { workItemId: items.c }),
      api('POST', '/api/timer/start', { workItemId: items.a }),
    ])
    assert.deepEqual(both.map((res) => res.status), [200, 200])
    const running = (await api('GET', '/api/timer')).body.timer
    assert.ok([items.a, items.c].includes(running.workItemId))
    assert.equal((await api('DELETE', '/api/timer')).status, 204)
    assert.deepEqual((await api('GET', '/api/timer')).body, { timer: null })
    assert.equal((await api('POST', '/api/timer/start', { workItemId: 999999 })).status, 404)
  })

  it('exporte les temps en CSV', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/projects/${projectId}/timesheet.csv` })
    assert.equal(response.statusCode, 200)
    assert.match(response.headers['content-type'] as string, /^text\/csv/)
    assert.match(response.headers['content-disposition'] as string, /attachment; filename="temps-planning-\d{4}-\d{2}-\d{2}\.csv"/)
    const lines = response.body.replace(/^﻿/, '').trim().split('\r\n')
    assert.equal(lines[0], 'ID;Type;Titre;Statut;Phase;Epic;Story;Budget (j);Réalisé (j);Réalisé (h);Bilan;Écart (j)')
    assert.equal(lines.length, 5)
    assert.match(lines.find((line) => line.startsWith(`#${items.a};`)) ?? '', /;1,5;/)
    assert.match(lines.at(-1) ?? '', /^TOTAL;/)
  })
})

describe('sauvegardes', () => {
  let dir: string
  let databaseFile: string
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'atelier-backups-'))
    databaseFile = path.join(dir, 'source.db')
    const db = new Database(databaseFile)
    db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('bonjour')")
    db.close()
  })
  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('copie la base, garde les N plus récentes et ignore les fichiers étrangers', async () => {
    let now = new Date('2026-11-02T08:00:00.000Z')
    const manager = new BackupManager({ databaseFile, dir: path.join(dir, 'backups'), keep: 2, now: () => now })
    const first = await manager.create('manual')
    assert.equal(first.name, 'atelier-2026-11-02T08-00-00-000-manual.db')
    const copy = new Database(path.join(dir, 'backups', first.name), { readonly: true })
    assert.deepEqual(copy.prepare('SELECT v FROM t').all(), [{ v: 'bonjour' }])
    copy.close()

    await writeFile(path.join(dir, 'backups', 'notes.txt'), 'à garder')
    now = new Date('2026-11-03T08:00:00.000Z')
    await manager.create('auto')
    now = new Date('2026-11-04T08:00:00.000Z')
    await manager.create('auto')
    const names = (await manager.list()).map((backup) => backup.name)
    assert.deepEqual(names, [
      'atelier-2026-11-04T08-00-00-000-auto.db',
      'atelier-2026-11-03T08-00-00-000-auto.db',
      'atelier-2026-11-02T08-00-00-000-manual.db',
    ])
    // Les copies automatiques ne chassent pas les manuelles : 2 de chaque sorte au plus.
    now = new Date('2026-11-05T08:00:00.000Z')
    await manager.create('auto')
    assert.deepEqual((await manager.list()).map((backup) => backup.name).slice(-2), [
      'atelier-2026-11-04T08-00-00-000-auto.db',
      'atelier-2026-11-02T08-00-00-000-manual.db',
    ])
    assert.ok((await readdir(path.join(dir, 'backups'))).includes('notes.txt'))
    assert.equal(await manager.file('../source.db'), null)
    assert.ok(await manager.file(first.name))
  })

  it('enchaîne les sauvegardes simultanées sans fichier partiel restant', async () => {
    let tick = 0
    const manager = new BackupManager({
      databaseFile,
      dir: path.join(dir, 'chain'),
      keep: 5,
      now: () => new Date(Date.UTC(2026, 10, 2, 8, 0, 0, tick++)),
    })
    const created = await Promise.all([manager.create('manual'), manager.create('manual'), manager.create('manual')])
    assert.equal(new Set(created.map((backup) => backup.name)).size, 3)
    const files = await readdir(path.join(dir, 'chain'))
    assert.equal(files.length, 3)
    assert.ok(files.every((name) => !name.endsWith('.partial')))

    const broken = new BackupManager({ databaseFile: path.join(dir, 'absente.db'), dir: path.join(dir, 'broken'), keep: 5 })
    await assert.rejects(broken.create('manual'))
    assert.deepEqual(await broken.list(), [])
  })

  it('expose les sauvegardes dans l’API', async () => {
    const manager = new BackupManager({ databaseFile, dir: path.join(dir, 'api'), keep: 3 })
    const ctx = await createTestContext({ backups: manager })
    try {
      const created = await call(ctx.app, 'POST', '/api/backups')
      assert.equal(created.status, 201)
      const list = await call(ctx.app, 'GET', '/api/backups')
      assert.equal(list.body.enabled, true)
      assert.equal(list.body.keep, 3)
      assert.deepEqual(list.body.backups.map((backup: any) => backup.name), [created.body.name])
      const download = await ctx.app.inject({ method: 'GET', url: `/api/backups/${created.body.name}` })
      assert.equal(download.statusCode, 200)
      assert.equal(download.rawPayload.subarray(0, 15).toString(), 'SQLite format 3')
      assert.equal((await call(ctx.app, 'GET', '/api/backups/atelier-2020-01-01T00-00-00-manual.db')).status, 404)
      assert.equal((await call(ctx.app, 'GET', '/api/backups/..%2Fsource.db')).status, 400)
    } finally {
      await ctx.close()
    }

    const disabled = await createTestContext()
    try {
      assert.equal((await call(disabled.app, 'GET', '/api/backups')).body.enabled, false)
      assert.equal((await call(disabled.app, 'POST', '/api/backups')).status, 400)
    } finally {
      await disabled.close()
    }
  })
})
