// Vues calculées sur le projet de démo : les chiffres des maquettes du README (§4) doivent ressortir tels quels.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { seedDemoProject } from '../prisma/demo-project.ts'
import { call, createTestContext, type TestContext } from './helpers/test-app.ts'

let ctx: TestContext
let projectId: number
before(async () => {
  ctx = await createTestContext({ seed: true })
  projectId = ctx.demoProjectId
})
after(async () => {
  await ctx.close()
})

const get = <T = any>(url: string) => call<T>(ctx.app, 'GET', url)

interface Row {
  id: number
  status: string
  estimate: { hours: number; days: number } | null
  spent: { hours: number; days: number }
  balance: { kind: string; delta: { hours: number; days: number } } | null
}

describe('dashboard (maquette A)', () => {
  it('donne la santé du budget et l’avancement réel', async () => {
    const { status, body } = await get(`/api/projects/${projectId}/dashboard`)
    assert.equal(status, 200)
    assert.equal(body.hoursPerDay, 8)
    assert.deepEqual(body.budget, {
      initial: { hours: 360, days: 45 },
      spent: { hours: 228, days: 28.5 },
      remaining: { hours: 132, days: 16.5 },
      balance: { kind: 'REMAINING', delta: { hours: 132, days: 16.5 } },
      consumedPercent: 63.3,
    })
    assert.deepEqual(body.progress, { percent: 70.7, planned: { hours: 280, days: 35 }, earned: { hours: 198, days: 24.75 } })
    assert.equal(body.trend, 'AHEAD')
    assert.deepEqual(body.workItems, { total: 17, done: 8, donePercent: 50 })
  })

  it('compte les éléments par statut et par type, dans l’ordre du workflow', async () => {
    const { body } = await get(`/api/projects/${projectId}/dashboard`)
    const histogram = Object.fromEntries(
      body.histogram.map((bar: { status: string; total: number; byType: Record<string, number> }) => [
        bar.status,
        [bar.byType.FEATURE, bar.byType.TASK, bar.byType.BUG],
      ]),
    )
    assert.deepEqual(Object.keys(histogram), ['OPEN', 'IN_PROGRESS', 'IN_REVIEW', 'ON_HOLD', 'BLOCKED', 'RESOLVED', 'CLOSED', 'REJECTED'])
    assert.deepEqual(histogram, {
      OPEN: [1, 1, 0],
      IN_PROGRESS: [2, 1, 0],
      IN_REVIEW: [0, 0, 1],
      ON_HOLD: [1, 0, 0],
      BLOCKED: [0, 1, 0],
      RESOLVED: [1, 2, 1],
      CLOSED: [2, 1, 1],
      REJECTED: [1, 0, 0],
    })
  })

  it('convertit avec un autre « 1 jour = X heures » sans toucher aux heures', async () => {
    const { body } = await get(`/api/projects/${projectId}/dashboard?hoursPerDay=7`)
    assert.equal(body.hoursPerDay, 7)
    assert.deepEqual(body.budget.initial, { hours: 360, days: 51.4286 })
    assert.equal((await get(`/api/projects/${projectId}/dashboard?hoursPerDay=0`)).status, 400)
  })
})

describe('arborescence / Gantt (maquette B)', () => {
  it('numérote et agrège phases, epics et stories', async () => {
    const { status, body } = await get(`/api/projects/${projectId}/tree`)
    assert.equal(status, 200)
    assert.deepEqual(body.range, { start: '2026-10-01', end: '2026-11-16' })
    assert.deepEqual(body.aggregate.estimate, { hours: 280, days: 35 })
    assert.equal(body.aggregate.progress, 70.7)

    const [phase1, phase2] = body.phases
    assert.deepEqual([phase1.code, phase1.title, phase1.aggregate.estimate.days], ['1', 'Socle Technique', 15])
    assert.deepEqual([phase2.code, phase2.title, phase2.aggregate.estimate.days], ['2', 'Expérience UI', 20])
    assert.deepEqual(phase1.span, { start: '2026-10-01', end: '2026-10-21' })

    const epic1 = phase1.epics[0]
    const epic2 = phase2.epics[0]
    assert.deepEqual([epic1.code, epic1.title, epic1.aggregate.estimate.days], ['1', 'Architecture', 15])
    assert.deepEqual([epic2.code, epic2.title, epic2.aggregate.estimate.days], ['2', 'Design System', 20])

    const [story11, story12] = epic1.stories
    assert.deepEqual([story11.code, story11.title, story11.aggregate.estimate.days], ['1.1', 'Auth', 6])
    assert.equal(story11.aggregate.status, 'IN_PROGRESS')
    assert.equal(story11.aggregate.progress, 98.3)
    assert.deepEqual(story11.aggregate.statusCounts, {
      OPEN: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 1,
      ON_HOLD: 0,
      BLOCKED: 0,
      RESOLVED: 1,
      CLOSED: 1,
      REJECTED: 0,
    })
    assert.deepEqual(story11.workItems.map((item: { id: number }) => item.id), [101, 102, 103])
    assert.equal(story12.code, '1.2')
    assert.ok(story12.workItems.some((item: { id: number }) => item.id === 12345))

    const story21 = epic2.stories[0]
    assert.deepEqual([story21.code, story21.title, story21.aggregate.estimate.days], ['2.1', 'Thèmes', 8])
    const [darkMode, tokens] = story21.workItems
    assert.deepEqual([darkMode.id, darkMode.progress, darkMode.status], [204, 80, 'IN_PROGRESS'])
    assert.deepEqual([tokens.id, tokens.progress, tokens.status], [205, 0, 'BLOCKED'])
  })

  it('place les jalons et les plages de dates des barres', async () => {
    const { body } = await get(`/api/projects/${projectId}/tree`)
    const [phase1, phase2] = body.phases
    assert.deepEqual(
      phase1.milestones.map((m: { title: string; date: string; reached: boolean }) => [m.title, m.date, m.reached]),
      [['API Prête', '2026-10-15', true]],
    )
    assert.deepEqual(
      phase2.milestones.map((m: { title: string; date: string; reached: boolean }) => [m.title, m.date, m.reached]),
      [['Beta UI', '2026-11-02', false]],
    )
    assert.deepEqual(body.milestones.map((m: { title: string }) => m.title), ['Mise en production v2'])

    const items = phase1.epics[0].stories.flatMap((story: { workItems: unknown[] }) => story.workItems)
    const span = (id: number) => items.find((item: { id: number }) => item.id === id).span
    assert.deepEqual(span(101), { start: '2026-10-01', end: '2026-10-06' })
    assert.equal(span(108), null)
  })
})

describe('tableau des temps (maquette D)', () => {
  it('reproduit budget, réalisé et bilan des lignes de la maquette', async () => {
    const { status, body } = await get(`/api/projects/${projectId}/timesheet`)
    assert.equal(status, 200)
    const rows = new Map<number, Row>(body.rows.map((row: Row) => [row.id, row]))
    const line = (id: number) => {
      const row = rows.get(id)!
      return [row.status, row.estimate?.days, row.spent.days, row.spent.hours, row.balance?.kind, row.balance?.delta.days]
    }
    assert.deepEqual(line(101), ['CLOSED', 3, 2.5, 20, 'UNDER', -0.5])
    assert.deepEqual(line(102), ['RESOLVED', 2, 2, 16, 'ON_BUDGET', 0])
    assert.deepEqual(line(103), ['IN_REVIEW', 1, 1.75, 14, 'OVER', 0.75])
    assert.deepEqual(line(12345), ['IN_PROGRESS', 3, 2.25, 18, 'REMAINING', 0.75])
    assert.deepEqual(line(205), ['BLOCKED', 3, 0.5, 4, 'REMAINING', 2.5])
    assert.equal(rows.get(108)!.balance, null)

    const mockup = [101, 102, 103, 12345, 205].map((id) => rows.get(id)!)
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
    assert.equal(sum(mockup.map((row) => row.estimate!.days)), 12)
    assert.equal(sum(mockup.map((row) => row.spent.hours)), 72)
  })

  it('totalise et suit l’ordre de la hiérarchie', async () => {
    const { body } = await get(`/api/projects/${projectId}/timesheet`)
    assert.equal(body.rows.length, 17)
    assert.deepEqual(body.rows.slice(0, 3).map((row: Row) => row.id), [101, 102, 103])
    assert.deepEqual(body.rows[0].path, {
      phase: { id: body.rows[0].path.phase.id, code: '1', title: 'Socle Technique' },
      epic: { id: body.rows[0].path.epic.id, code: '1', title: 'Architecture' },
      story: { id: body.rows[0].path.story.id, code: '1.1', title: 'Auth' },
    })
    assert.deepEqual(body.totals, {
      count: 17,
      done: 8,
      donePercent: 50,
      estimate: { hours: 280, days: 35 },
      spent: { hours: 228, days: 28.5 },
      remaining: { hours: 52, days: 6.5 },
      balance: { kind: 'REMAINING', delta: { hours: 52, days: 6.5 } },
    })
  })

  it('filtre par epic, statut et type', async () => {
    const tree = (await get(`/api/projects/${projectId}/tree`)).body
    const epic2 = tree.phases[1].epics[0]
    const byEpic = (await get(`/api/projects/${projectId}/timesheet?epicId=${epic2.id}`)).body
    assert.deepEqual(byEpic.rows.map((row: Row) => row.id), [204, 205, 206, 207, 209, 208, 210, 211])
    assert.deepEqual(byEpic.totals.estimate, { hours: 160, days: 20 })
    assert.deepEqual(byEpic.totals.spent, { hours: 113, days: 14.125 })

    const active = (await get(`/api/projects/${projectId}/timesheet?status=IN_PROGRESS&status=BLOCKED`)).body
    assert.deepEqual(active.rows.map((row: Row) => row.id), [12345, 204, 205, 208])
    const bugs = (await get(`/api/projects/${projectId}/timesheet?type=BUG`)).body
    assert.deepEqual(bugs.rows.map((row: Row) => row.id), [103, 107, 209])

    const phase1 = tree.phases[0]
    const byPhase = (await get(`/api/projects/${projectId}/timesheet?phaseId=${phase1.id}`)).body
    assert.deepEqual(byPhase.rows.map((row: Row) => row.id), [101, 102, 103, 104, 105, 107, 12345, 106, 108])
    assert.deepEqual(byPhase.totals.estimate, { hours: 120, days: 15 })
    const story11 = phase1.epics[0].stories[0]
    const byStory = (await get(`/api/projects/${projectId}/timesheet?storyId=${story11.id}`)).body
    assert.deepEqual(byStory.rows.map((row: Row) => row.id), [101, 102, 103])
    assert.deepEqual(byStory.totals, {
      count: 3,
      done: 2,
      donePercent: 66.7,
      estimate: { hours: 48, days: 6 },
      spent: { hours: 50, days: 6.25 },
      remaining: { hours: -2, days: -0.25 },
      balance: { kind: 'OVER', delta: { hours: 2, days: 0.25 } },
    })
  })

  it('applique « 1 jour = X heures » demandé par la vue', async () => {
    const sheet = (await get(`/api/projects/${projectId}/timesheet?hoursPerDay=7`)).body
    assert.equal(sheet.hoursPerDay, 7)
    const row101 = sheet.rows.find((row: Row) => row.id === 101)
    assert.deepEqual(row101.estimate, { hours: 24, days: 3.4286 })
    assert.deepEqual(row101.balance, { kind: 'UNDER', delta: { hours: -4, days: -0.5714 } })
    assert.deepEqual(sheet.totals.spent, { hours: 228, days: 32.5714 })

    const tree = (await get(`/api/projects/${projectId}/tree?hoursPerDay=7`)).body
    assert.equal(tree.hoursPerDay, 7)
    assert.deepEqual(tree.phases[0].aggregate.estimate, { hours: 120, days: 17.1429 })
    assert.deepEqual(tree.phases[0].epics[0].stories[0].workItems[0].spent, { hours: 20, days: 2.8571 })

    const item = (await get('/api/work-items/101?hoursPerDay=7')).body
    assert.deepEqual(item.estimate, { hours: 24, days: 3.4286 })
    assert.deepEqual(item.balance, { kind: 'UNDER', delta: { hours: -4, days: -0.5714 } })
    assert.deepEqual(item.project.hoursPerDay, 8)
    assert.deepEqual(item.timeEntries[0].duration.days, Number((item.timeEntries[0].duration.hours / 7).toFixed(4)))
  })
})

describe('fiche tâche #12345 (maquette C)', () => {
  it('regroupe parent, temps, description, journal et commits', async () => {
    const { status, body } = await get('/api/work-items/12345')
    assert.equal(status, 200)
    assert.equal(body.type, 'FEATURE')
    assert.equal(body.status, 'IN_PROGRESS')
    assert.equal(body.priority, 'HIGH')
    assert.deepEqual(
      [body.path.phase.code, body.path.epic.code, body.path.story.code],
      ['1', '1', '1.2'],
    )
    assert.deepEqual(body.estimate, { hours: 24, days: 3 })
    assert.deepEqual(body.spent, { hours: 18, days: 2.25 })
    assert.match(body.description, /- \[ \] Synchroniser le statut avec les Pull Requests GitHub/)
    assert.match(body.implementationLog, /\*\*18 Oct 2026 - 16h30 \(4\.5h passées\) :\*\*/)
    assert.equal(body.timeEntries.length, 5)
    assert.deepEqual([body.timeEntries[0].spentOn, body.timeEntries[0].duration.hours], ['2026-10-18', 4.5])
    assert.deepEqual(
      body.commits.map((commit: { shortHash: string; keyword: string; message: string }) => [commit.shortHash, commit.keyword, commit.message]),
      [
        ['a8f4d21', 'feature', 'feat: add regex parser for feature #12345 in git-engine'],
        ['c3e91b0', 'feature', 'wip: database schema for git links feature #12345'],
      ],
    )
    assert.deepEqual(
      body.pullRequests.map((pr: { number: number; title: string; status: string; source: string }) => [pr.number, pr.title, pr.status, pr.source]),
      [[42, 'Feature/12345 git sync engine', 'IN_REVIEW', 'branch']],
    )
  })

  it('renvoie une 404 explicite pour un #ID inconnu', async () => {
    const { status, body } = await get('/api/work-items/999999')
    assert.equal(status, 404)
    assert.deepEqual(body, { statusCode: 404, error: 'Not Found', code: 'NOT_FOUND', message: 'Élément #999999 introuvable' })
  })
})

describe('numérotation, seed et documentation', () => {
  it('poursuit les #ID après #12345 et garde un seed idempotent', async () => {
    const storyId = (await get(`/api/projects/${projectId}/tree`)).body.phases[0].epics[0].stories[0].id
    const created = await call(ctx.app, 'POST', `/api/stories/${storyId}/work-items`, { type: 'BUG', title: 'Nouveau bug' })
    assert.equal(created.body.id, 12346)

    const reseeded = await seedDemoProject(ctx.prisma)
    projectId = reseeded
    assert.equal(await ctx.prisma.project.count(), 1)
    assert.equal(await ctx.prisma.workItem.count(), 17)
    assert.equal((await get(`/api/projects/${projectId}/dashboard`)).body.budget.spent.hours, 228)
  })

  it('publie une description OpenAPI 3.1 de toutes les routes', async () => {
    const { status, body } = await get('/api/docs/json')
    assert.equal(status, 200)
    assert.equal(body.openapi, '3.1.0')
    for (const route of [
      '/api/projects/{projectId}/dashboard',
      '/api/projects/{projectId}/tree',
      '/api/projects/{projectId}/timesheet',
      '/api/work-items/{workItemId}/log-entries',
      '/api/work-items/{workItemId}/time-entries',
      '/api/milestones/{milestoneId}',
      '/api/projects/{projectId}/git/scan',
      '/api/projects/{projectId}/git/hook',
      '/api/projects/{projectId}/commits',
      '/api/projects/{projectId}/github/sync',
      '/api/projects/{projectId}/pull-requests',
    ]) {
      assert.ok(body.paths[route], `route absente de l’OpenAPI : ${route}`)
    }
  })
})
