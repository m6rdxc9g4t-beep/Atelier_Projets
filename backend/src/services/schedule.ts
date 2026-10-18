// Planification du Gantt : dépendances « fin → début », décalage d'un conteneur avec son contenu,
// résolution des conflits de dépendances.
import { formatDateOnly, parseDateOnly } from '../domain/dates.ts'
import { effectiveSpan, type DateSpan } from '../domain/hierarchy.ts'
import { criticalPath, daysBetween, dependencySlack, resolveConflicts, shiftDay, wouldCreateCycle, type Dependency } from '../domain/schedule.ts'
import type { PrismaClient } from '../db/client.ts'
import { badRequest, conflict, notFound } from '../http/errors.ts'
import type {
  DependencyCreate,
  DependencyRefDto,
  ProjectDependencyDto,
  ResolveResultDto,
  ShiftInput,
  ShiftResultDto,
} from '../schemas/schedule.ts'
import { requireProject } from './common.ts'

type Dated = { startDate: Date | null; dueDate: Date | null }

function spanOf(item: Dated): DateSpan | null {
  return effectiveSpan(item)
}

// --- Dépendances --------------------------------------------------------------------------------------

/** Dépendances d'un projet, avec marge et conflit, et le chemin critique (vue Gantt). */
export async function projectSchedule(
  prisma: PrismaClient,
  projectId: number,
): Promise<{ dependencies: ProjectDependencyDto[]; criticalPath: number[] }> {
  const [items, dependencies] = await Promise.all([
    prisma.workItem.findMany({ where: { projectId }, select: { id: true, status: true, startDate: true, dueDate: true } }),
    prisma.workItemDependency.findMany({
      where: { successor: { projectId } },
      select: { predecessorId: true, successorId: true },
      orderBy: [{ predecessorId: 'asc' }, { successorId: 'asc' }],
    }),
  ])
  // Les éléments rejetés sortent du planning (ni chemin critique, ni conflit).
  const spans = new Map(items.filter((item) => item.status !== 'REJECTED').map((item) => [item.id, spanOf(item)]))
  return {
    dependencies: dependencies.map((dependency) => {
      const slackDays = dependencySlack(spans.get(dependency.predecessorId) ?? null, spans.get(dependency.successorId) ?? null)
      return { ...dependency, slackDays, conflict: slackDays !== null && slackDays < 0 }
    }),
    criticalPath: criticalPath(spans, dependencies),
  }
}

/** Prédécesseurs et successeurs d'un élément (fiche). */
export async function workItemDependencies(
  prisma: PrismaClient,
  workItemId: number,
): Promise<{ predecessors: DependencyRefDto[]; successors: DependencyRefDto[] }> {
  const select = { id: true, type: true, title: true, status: true, startDate: true, dueDate: true } as const
  const item = await prisma.workItem.findUnique({
    where: { id: workItemId },
    select: {
      ...select,
      predecessors: { select: { predecessor: { select } }, orderBy: { predecessorId: 'asc' } },
      successors: { select: { successor: { select } }, orderBy: { successorId: 'asc' } },
    },
  })
  if (!item) throw notFound(`Élément #${workItemId} introuvable`)
  // Comme dans le Gantt : un élément rejeté sort du planning (pas de marge ni de conflit).
  const planned = (other: Dated & { status: string }) => (other.status === 'REJECTED' ? null : spanOf(other))
  const own = planned(item)
  const ref = (other: typeof item.predecessors[number]['predecessor'], slackDays: number | null): DependencyRefDto => ({
    id: other.id,
    type: other.type,
    title: other.title,
    status: other.status,
    slackDays,
  })
  return {
    predecessors: item.predecessors.map(({ predecessor }) => ref(predecessor, dependencySlack(planned(predecessor), own))),
    successors: item.successors.map(({ successor }) => ref(successor, dependencySlack(own, planned(successor)))),
  }
}

export async function addDependency(prisma: PrismaClient, successorId: number, input: DependencyCreate): Promise<void> {
  const [successor, predecessor] = await Promise.all([
    prisma.workItem.findUnique({ where: { id: successorId }, select: { projectId: true } }),
    prisma.workItem.findUnique({ where: { id: input.predecessorId }, select: { projectId: true } }),
  ])
  if (!successor) throw notFound(`Élément #${successorId} introuvable`)
  if (!predecessor) throw badRequest(`Élément #${input.predecessorId} introuvable`)
  if (predecessor.projectId !== successor.projectId) throw badRequest(`#${input.predecessorId} appartient à un autre projet`)
  if (input.predecessorId === successorId) throw badRequest('Un élément ne peut pas dépendre de lui-même')

  await prisma.$transaction(async (tx) => {
    const existing = await tx.workItemDependency.findMany({
      where: { successor: { projectId: successor.projectId } },
      select: { predecessorId: true, successorId: true },
    })
    if (existing.some((dependency) => dependency.predecessorId === input.predecessorId && dependency.successorId === successorId)) {
      throw conflict(`#${successorId} dépend déjà de #${input.predecessorId}`)
    }
    if (wouldCreateCycle(existing, input.predecessorId, successorId)) {
      throw badRequest(`Dépendance refusée : #${input.predecessorId} dépend déjà (directement ou non) de #${successorId}, ce qui créerait une boucle`)
    }
    await tx.workItemDependency.create({ data: { predecessorId: input.predecessorId, successorId } })
  })
}

export async function removeDependency(prisma: PrismaClient, successorId: number, predecessorId: number): Promise<void> {
  const deleted = await prisma.workItemDependency.deleteMany({ where: { successorId, predecessorId } })
  if (deleted.count === 0) throw notFound(`#${successorId} ne dépend pas de #${predecessorId}`)
}

/** Replanifie les éléments en conflit : chaque successeur commence le lendemain de la fin de ses prédécesseurs. */
export async function resolveScheduleConflicts(prisma: PrismaClient, projectId: number): Promise<ResolveResultDto> {
  await requireProject(prisma, projectId)
  return prisma.$transaction(async (tx) => {
    const [items, dependencies] = await Promise.all([
      tx.workItem.findMany({ where: { projectId }, select: { id: true, status: true, startDate: true, dueDate: true } }),
      tx.workItemDependency.findMany({ where: { successor: { projectId } }, select: { predecessorId: true, successorId: true } }),
    ])
    const spans = new Map(items.filter((item) => item.status !== 'REJECTED').map((item) => [item.id, spanOf(item)]))
    const active = dependencies.filter((dependency: Dependency) => spans.has(dependency.predecessorId) && spans.has(dependency.successorId))
    const moved = resolveConflicts(spans, active)
    const own = new Map(items.map((item) => [item.id, item]))
    for (const [id, span] of moved) {
      // Décalage des seules dates renseignées : un élément planifié par sa seule échéance le reste.
      const item = own.get(id)
      const before = spans.get(id)
      if (!item || !before) continue
      const days = daysBetween(before.start, span.start)
      await tx.workItem.update({ where: { id }, data: { startDate: shifted(item.startDate, days), dueDate: shifted(item.dueDate, days) } })
    }
    return { moved: [...moved].map(([id, span]) => ({ id, startDate: span.start, dueDate: span.end })).sort((a, b) => a.id - b.id) }
  })
}

// --- Décalage d'un conteneur -----------------------------------------------------------------------

function shifted(date: Date | null, days: number): Date | null {
  return date === null ? null : parseDateOnly(shiftDay(formatDateOnly(date), days))
}

type Level = 'phase' | 'epic' | 'story'

/**
 * Déplace une barre de Gantt (phase, epic ou story) : ses propres dates, celles de tout son contenu
 * (epics, stories, éléments) et, pour une phase, de ses jalons — tout ou rien.
 */
export async function shiftContainer(prisma: PrismaClient, level: Level, id: number, input: ShiftInput): Promise<ShiftResultDto> {
  const days = input.days
  return prisma.$transaction(async (tx) => {
    let storyIds: number[] = []
    let epicIds: number[] = []
    let phaseIds: number[] = []
    if (level === 'phase') {
      const phase = await tx.phase.findUnique({ where: { id }, select: { id: true, epics: { select: { id: true, stories: { select: { id: true } } } } } })
      if (!phase) throw notFound(`Phase #${id} introuvable`)
      phaseIds = [phase.id]
      epicIds = phase.epics.map((epic) => epic.id)
      storyIds = phase.epics.flatMap((epic) => epic.stories.map((story) => story.id))
    } else if (level === 'epic') {
      const epic = await tx.epic.findUnique({ where: { id }, select: { id: true, stories: { select: { id: true } } } })
      if (!epic) throw notFound(`Epic #${id} introuvable`)
      epicIds = [epic.id]
      storyIds = epic.stories.map((story) => story.id)
    } else {
      const story = await tx.story.findUnique({ where: { id }, select: { id: true } })
      if (!story) throw notFound(`Story #${id} introuvable`)
      storyIds = [story.id]
    }

    let containers = 0
    const shiftRows = async (rows: Array<{ id: number } & Dated>, update: (id: number, data: Dated) => Promise<unknown>) => {
      let count = 0
      for (const row of rows) {
        if (row.startDate === null && row.dueDate === null) continue
        await update(row.id, { startDate: shifted(row.startDate, days), dueDate: shifted(row.dueDate, days) })
        count += 1
      }
      return count
    }
    const dates = { id: true, startDate: true, dueDate: true } as const
    containers += await shiftRows(await tx.phase.findMany({ where: { id: { in: phaseIds } }, select: dates }), (rowId, data) =>
      tx.phase.update({ where: { id: rowId }, data }),
    )
    containers += await shiftRows(await tx.epic.findMany({ where: { id: { in: epicIds } }, select: dates }), (rowId, data) =>
      tx.epic.update({ where: { id: rowId }, data }),
    )
    containers += await shiftRows(await tx.story.findMany({ where: { id: { in: storyIds } }, select: dates }), (rowId, data) =>
      tx.story.update({ where: { id: rowId }, data }),
    )
    const workItems = await shiftRows(await tx.workItem.findMany({ where: { storyId: { in: storyIds } }, select: dates }), (rowId, data) =>
      tx.workItem.update({ where: { id: rowId }, data }),
    )
    let milestones = 0
    if (phaseIds.length > 0) {
      for (const milestone of await tx.milestone.findMany({ where: { phaseId: { in: phaseIds } }, select: { id: true, date: true } })) {
        await tx.milestone.update({ where: { id: milestone.id }, data: { date: shifted(milestone.date, days) as Date } })
        milestones += 1
      }
    }
    if (containers + workItems + milestones === 0) throw badRequest('Rien à déplacer : ni ce conteneur ni son contenu n’ont de dates')
    return { workItems, containers, milestones }
  })
}
