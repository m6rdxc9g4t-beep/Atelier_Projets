// Tests d'intégration CRUD sur une base vierge : tout est créé via l'API.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { todayDateOnly } from '../src/domain/dates.ts'
import { call, createTestContext, type TestContext } from './helpers/test-app.ts'

let ctx: TestContext
before(async () => {
  ctx = await createTestContext()
})
after(async () => {
  await ctx.close()
})

const api = <T = any>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  call<T>(ctx.app, method, url, payload)

/** Crée projet > phase > epic > story et renvoie leurs ids. */
async function scaffold(name: string, project: Record<string, unknown> = {}) {
  const p = await api('POST', '/api/projects', { name, ...project })
  assert.equal(p.status, 201, JSON.stringify(p.body))
  const phase = await api('POST', `/api/projects/${p.body.id}/phases`, { title: 'Phase A' })
  const epic = await api('POST', `/api/phases/${phase.body.id}/epics`, { title: 'Epic A' })
  const story = await api('POST', `/api/epics/${epic.body.id}/stories`, { title: 'Story A' })
  return { projectId: p.body.id as number, phaseId: phase.body.id as number, epicId: epic.body.id as number, storyId: story.body.id as number }
}

describe('projets', () => {
  it('crée un projet : slug généré, budget saisi en jours converti avec hoursPerDay', async () => {
    const { status, body } = await api('POST', '/api/projects', { name: 'Refonte Site Vitrine', budgetDays: 10, hoursPerDay: 7 })
    assert.equal(status, 201)
    assert.equal(body.slug, 'refonte-site-vitrine')
    assert.deepEqual(body.budget, { hours: 70, days: 10 })
    assert.equal(body.hoursPerDay, 7)
    assert.equal(body.github, null)
    assert.equal(body.defaultBranch, 'main')

    const again = await api('POST', '/api/projects', { name: 'Refonte Site Vitrine' })
    assert.equal(again.body.slug, 'refonte-site-vitrine-2')
    assert.deepEqual(again.body.budget, null)
    assert.equal(again.body.hoursPerDay, 8)
  })

  it('expose le dépôt GitHub et accepte les modifications partielles', async () => {
    const created = await api('POST', '/api/projects', { name: 'Atelier', githubOwner: 'francois', githubRepo: 'atelier' })
    assert.deepEqual(created.body.github, { owner: 'francois', repo: 'atelier', url: 'https://github.com/francois/atelier' })
    const patched = await api('PATCH', `/api/projects/${created.body.id}`, {
      description: 'Gestionnaire local',
      budgetHours: 120,
      startDate: '2026-10-01',
    })
    assert.equal(patched.status, 200)
    assert.equal(patched.body.name, 'Atelier')
    assert.equal(patched.body.description, 'Gestionnaire local')
    assert.deepEqual(patched.body.budget, { hours: 120, days: 15 })
    assert.equal(patched.body.startDate, '2026-10-01')
    assert.equal((await api('GET', '/api/projects')).body.length, 3)

    const linked = await api('PATCH', `/api/projects/${created.body.id}`, { localRepoPath: '/Users/francois/dev/atelier' })
    assert.equal(linked.body.localRepoPath, '/Users/francois/dev/atelier')
    const unlinked = await api('PATCH', `/api/projects/${created.body.id}`, {
      localRepoPath: null,
      githubOwner: null,
      githubRepo: null,
      budgetDays: null,
    })
    assert.deepEqual([unlinked.body.localRepoPath, unlinked.body.github, unlinked.body.budget], [null, null, null])
  })

  it('refuse les saisies incohérentes', async () => {
    const conflictSlug = await api('POST', '/api/projects', { name: 'X', slug: 'refonte-site-vitrine' })
    assert.equal(conflictSlug.status, 409)
    assert.equal(conflictSlug.body.code, 'CONFLICT')

    const both = await api('POST', '/api/projects', { name: 'X', budgetHours: 8, budgetDays: 1 })
    assert.equal(both.status, 400)
    assert.match(both.body.message, /budgetHours ou budgetDays/)

    const unknown = await api('POST', '/api/projects', { name: 'X', budget: 3 })
    assert.equal(unknown.status, 400)
    assert.equal(unknown.body.code, 'VALIDATION_ERROR')

    const halfGithub = await api('POST', '/api/projects', { name: 'X', githubOwner: 'francois' })
    assert.equal(halfGithub.status, 400)

    const dates = await api('POST', '/api/projects', { name: 'X', startDate: '2026-10-10', dueDate: '2026-10-01' })
    assert.equal(dates.status, 400)

    const badDate = await api('POST', '/api/projects', { name: 'X', startDate: '2026-02-30' })
    assert.equal(badDate.status, 400)

    const missing = await api('GET', '/api/projects/9999')
    assert.equal(missing.status, 404)
    assert.equal(missing.body.message, 'Projet #9999 introuvable')
  })
})

describe('hiérarchie et éléments', () => {
  it('ajoute les conteneurs en fin de liste', async () => {
    const { projectId, phaseId } = await scaffold('Hiérarchie')
    const second = await api('POST', `/api/projects/${projectId}/phases`, { title: 'Phase B', startDate: '2026-11-01' })
    assert.equal(second.body.position, 2)
    const phases = await api('GET', `/api/projects/${projectId}/phases`)
    assert.deepEqual(
      phases.body.map((phase: { id: number; position: number }) => [phase.id, phase.position]),
      [
        [phaseId, 1],
        [second.body.id, 2],
      ],
    )
  })

  it('crée un élément : estimation en jours, statut et avancement par défaut', async () => {
    const { storyId } = await scaffold('Éléments', { hoursPerDay: 7 })
    const { status, body } = await api('POST', `/api/stories/${storyId}/work-items`, {
      type: 'FEATURE',
      title: 'Page contact',
      estimatedDays: 2,
      startDate: '2026-10-12',
      dueDate: '2026-10-14',
    })
    assert.equal(status, 201)
    assert.equal(body.status, 'OPEN')
    assert.equal(body.priority, 'NORMAL')
    assert.equal(body.progress, 0)
    assert.equal(body.position, 1)
    assert.deepEqual(body.estimate, { hours: 14, days: 2 })
    assert.deepEqual(body.spent, { hours: 0, days: 0 })
    assert.deepEqual(body.balance, { kind: 'REMAINING', delta: { hours: 14, days: 2 } })
    assert.deepEqual(body.path, {
      phase: { id: body.path.phase.id, code: '1', title: 'Phase A' },
      epic: { id: body.path.epic.id, code: '1', title: 'Epic A' },
      story: { id: storyId, code: '1.1', title: 'Story A' },
    })

    const closed = await api('POST', `/api/stories/${storyId}/work-items`, { type: 'BUG', title: 'Déjà corrigé', status: 'CLOSED' })
    assert.equal(closed.body.progress, 100)
    assert.equal(closed.body.position, 2)

    const tooMuch = await api('POST', `/api/stories/${storyId}/work-items`, { type: 'TASK', title: 'X', progress: 150 })
    assert.equal(tooMuch.status, 400)
    const badType = await api('POST', `/api/stories/${storyId}/work-items`, { type: 'EPIC', title: 'X' })
    assert.equal(badType.status, 400)
  })

  it('met à jour statut, avancement et estimation', async () => {
    const { storyId } = await scaffold('Workflow')
    const item = (await api('POST', `/api/stories/${storyId}/work-items`, { type: 'TASK', title: 'Config CI', estimatedHours: 6 })).body

    const resolved = await api('PATCH', `/api/work-items/${item.id}`, { status: 'RESOLVED' })
    assert.equal(resolved.body.status, 'RESOLVED')
    assert.equal(resolved.body.progress, 100)

    const reopened = await api('PATCH', `/api/work-items/${item.id}`, { status: 'IN_PROGRESS', progress: 40, estimatedDays: 1.5 })
    assert.equal(reopened.body.progress, 40)
    assert.deepEqual(reopened.body.estimate, { hours: 12, days: 1.5 })

    const cleared = await api('PATCH', `/api/work-items/${item.id}`, { estimatedHours: null, description: '### À faire' })
    assert.equal(cleared.body.estimate, null)
    assert.equal(cleared.body.balance, null)
    assert.equal(cleared.body.description, '### À faire')

    // 0 reste 0 et null efface (pas de coercition null → 0 / "")
    const zero = await api('PATCH', `/api/work-items/${item.id}`, { estimatedHours: 0 })
    assert.deepEqual(zero.body.estimate, { hours: 0, days: 0 })
    await api('PATCH', `/api/work-items/${item.id}`, { startDate: '2026-10-01', dueDate: '2026-10-05' })
    const noDue = await api('PATCH', `/api/work-items/${item.id}`, { dueDate: null })
    assert.deepEqual([noDue.body.startDate, noDue.body.dueDate], ['2026-10-01', null])

    const badDates = await api('PATCH', `/api/work-items/${item.id}`, { startDate: '2026-10-20', dueDate: '2026-10-10' })
    assert.equal(badDates.status, 400)
    const unknownField = await api('PATCH', `/api/work-items/${item.id}`, { estimateDays: 2 })
    assert.equal(unknownField.status, 400)
  })

  it('déplace éléments, stories et epics uniquement dans le même projet', async () => {
    const a = await scaffold('Projet A')
    const b = await scaffold('Projet B')
    const otherEpic = (await api('POST', `/api/phases/${a.phaseId}/epics`, { title: 'Epic A2' })).body
    const otherStory = (await api('POST', `/api/epics/${otherEpic.id}/stories`, { title: 'Story A2' })).body
    await api('POST', `/api/stories/${otherStory.id}/work-items`, { type: 'TASK', title: 'Déjà là' })
    const item = (await api('POST', `/api/stories/${a.storyId}/work-items`, { type: 'FEATURE', title: 'Mobile' })).body

    const moved = await api('PATCH', `/api/work-items/${item.id}`, { storyId: otherStory.id })
    assert.equal(moved.status, 200)
    assert.equal(moved.body.storyId, otherStory.id)
    assert.equal(moved.body.position, 2)
    assert.equal(moved.body.path.story.code, '2.1')

    const foreign = await api('PATCH', `/api/work-items/${item.id}`, { storyId: b.storyId })
    assert.equal(foreign.status, 400)
    assert.match(foreign.body.message, /autre projet/)
    assert.equal((await api('PATCH', `/api/stories/${a.storyId}`, { epicId: b.epicId })).status, 400)
    assert.equal((await api('PATCH', `/api/epics/${a.epicId}`, { phaseId: b.phaseId })).status, 400)
    assert.equal((await api('PATCH', `/api/epics/${a.epicId}`, { phaseId: 9999 })).status, 400)

    const storyMoved = await api('PATCH', `/api/stories/${a.storyId}`, { epicId: otherEpic.id })
    assert.equal(storyMoved.body.epicId, otherEpic.id)
    assert.equal(storyMoved.body.position, 2)
  })

  it('filtre les éléments d’un projet', async () => {
    const { projectId, storyId } = await scaffold('Filtres')
    for (const [type, title, status] of [
      ['FEATURE', 'Recherche produits', 'OPEN'],
      ['BUG', 'Panier vide', 'BLOCKED'],
      ['TASK', 'Index SQL', 'CLOSED'],
    ] as const) {
      await api('POST', `/api/stories/${storyId}/work-items`, { type, title, status })
    }
    const bugs = await api('GET', `/api/projects/${projectId}/work-items?type=BUG`)
    assert.deepEqual(bugs.body.map((i: { title: string }) => i.title), ['Panier vide'])
    const several = await api('GET', `/api/projects/${projectId}/work-items?status=OPEN&status=CLOSED`)
    assert.deepEqual(several.body.map((i: { title: string }) => i.title), ['Recherche produits', 'Index SQL'])
    const search = await api('GET', `/api/projects/${projectId}/work-items?q=panier`)
    assert.equal(search.body.length, 1)
    const byId = await api('GET', `/api/projects/${projectId}/work-items?q=%23${search.body[0].id}`)
    assert.equal(byId.body[0].id, search.body[0].id)
    assert.equal((await api('GET', `/api/stories/${storyId}/work-items`)).body.length, 3)
  })
})

describe('temps et journal d’avancement', () => {
  it('saisit, corrige et supprime du temps', async () => {
    const { storyId } = await scaffold('Temps')
    const item = (await api('POST', `/api/stories/${storyId}/work-items`, { type: 'TASK', title: 'Recette', estimatedHours: 8 })).body

    const first = await api('POST', `/api/work-items/${item.id}/time-entries`, { hours: 3.5, spentOn: '2026-10-15', comment: ' Maquette ' })
    assert.equal(first.status, 201)
    assert.deepEqual(first.body.duration, { hours: 3.5, days: 0.4375 })
    assert.equal(first.body.comment, 'Maquette')
    const today = await api('POST', `/api/work-items/${item.id}/time-entries`, { hours: 6 })
    assert.equal(today.body.spentOn, todayDateOnly('Europe/Paris'))

    const fixed = await api('PATCH', `/api/time-entries/${first.body.id}`, { hours: 4 })
    assert.deepEqual(fixed.body.duration, { hours: 4, days: 0.5 })

    const detail = (await api('GET', `/api/work-items/${item.id}`)).body
    assert.deepEqual(detail.spent, { hours: 10, days: 1.25 })
    assert.deepEqual(detail.balance, { kind: 'OVER', delta: { hours: 2, days: 0.25 } })
    assert.equal(detail.timeEntries.length, 2)

    assert.equal((await api('DELETE', `/api/time-entries/${today.body.id}`)).status, 204)
    assert.equal((await api('GET', `/api/work-items/${item.id}/time-entries`)).body.length, 1)
    assert.equal((await api('POST', `/api/work-items/${item.id}/time-entries`, { hours: 0 })).status, 400)
    assert.equal((await api('POST', `/api/work-items/${item.id}/time-entries`, { hours: 25 })).status, 400)
    assert.equal((await api('DELETE', `/api/time-entries/${today.body.id}`)).status, 404)
  })

  it('ajoute des entrées horodatées au journal', async () => {
    const { storyId } = await scaffold('Journal')
    const item = (await api('POST', `/api/stories/${storyId}/work-items`, { type: 'FEATURE', title: 'Formulaire' })).body

    const first = await api('POST', `/api/work-items/${item.id}/log-entries`, {
      text: 'Formulaire branché sur l’API.',
      at: '2026-10-18T14:30:00Z',
      hours: 2,
    })
    assert.equal(first.status, 201)
    assert.equal(first.body.implementationLog, '> **18 Oct 2026 - 16h30 (2h passées) :** Formulaire branché sur l’API.')

    const second = await api('POST', `/api/work-items/${item.id}/log-entries`, { text: 'Tests ajoutés.', at: '2026-10-19T07:05:00Z' })
    assert.equal(
      second.body.implementationLog,
      '> **18 Oct 2026 - 16h30 (2h passées) :** Formulaire branché sur l’API.\n\n> **19 Oct 2026 - 09h05 :** Tests ajoutés.',
    )
    assert.equal((await api('POST', `/api/work-items/${item.id}/log-entries`, { text: '   ' })).status, 400)
  })
})

describe('jalons et suppressions', () => {
  it('gère les jalons de projet et de phase', async () => {
    const a = await scaffold('Jalons')
    const b = await scaffold('Autre')
    const projectMilestone = await api('POST', `/api/projects/${a.projectId}/milestones`, { title: 'Recette', date: '2026-11-20' })
    assert.equal(projectMilestone.status, 201)
    assert.equal(projectMilestone.body.phaseId, null)
    assert.equal(projectMilestone.body.reached, false)

    const phaseMilestone = await api('POST', `/api/projects/${a.projectId}/milestones`, {
      title: 'Maquettes validées',
      date: '2026-10-30',
      phaseId: a.phaseId,
    })
    assert.equal(phaseMilestone.body.phaseId, a.phaseId)
    assert.equal(
      (await api('POST', `/api/projects/${a.projectId}/milestones`, { title: 'X', date: '2026-10-30', phaseId: b.phaseId })).status,
      400,
    )

    const reached = await api('PATCH', `/api/milestones/${phaseMilestone.body.id}`, { reachedAt: '2026-10-29T16:00:00.000Z' })
    assert.equal(reached.body.reached, true)
    assert.equal(reached.body.reachedAt, '2026-10-29T16:00:00.000Z')

    const list = await api('GET', `/api/projects/${a.projectId}/milestones`)
    assert.deepEqual(list.body.map((m: { title: string }) => m.title), ['Maquettes validées', 'Recette'])

    const unreached = await api('PATCH', `/api/milestones/${projectMilestone.body.id}`, { reachedAt: null, phaseId: a.phaseId })
    assert.deepEqual([unreached.body.reached, unreached.body.phaseId], [false, a.phaseId])
    const detached = await api('PATCH', `/api/milestones/${projectMilestone.body.id}`, { phaseId: null })
    assert.equal(detached.body.phaseId, null)

    // Supprimer la phase garde son jalon, rattaché au projet.
    assert.equal((await api('DELETE', `/api/phases/${a.phaseId}`)).status, 204)
    assert.equal((await api('GET', `/api/milestones/${phaseMilestone.body.id}`)).body.phaseId, null)
  })

  it('supprime un projet et tout son contenu', async () => {
    const { projectId, storyId } = await scaffold('Éphémère')
    const item = (await api('POST', `/api/stories/${storyId}/work-items`, { type: 'TASK', title: 'Temporaire' })).body
    await api('POST', `/api/work-items/${item.id}/time-entries`, { hours: 1 })

    assert.equal((await api('DELETE', `/api/projects/${projectId}`)).status, 204)
    assert.equal((await api('GET', `/api/projects/${projectId}`)).status, 404)
    const gone = await api('GET', `/api/work-items/${item.id}`)
    assert.equal(gone.status, 404)
    assert.equal(gone.body.message, `Élément #${item.id} introuvable`)
    assert.equal(await ctx.prisma.timeEntry.count({ where: { workItemId: item.id } }), 0)
  })
})
