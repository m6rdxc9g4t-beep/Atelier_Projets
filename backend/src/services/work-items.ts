// WorkItems : liste filtrée, fiche complète (double onglet, temps, commits), écriture, déplacement
// entre stories du même projet, et ajout d'entrées horodatées au journal d'avancement.
import { sumHours } from '../domain/durations.ts'
import { computeCodes } from '../domain/hierarchy.ts'
import { appendLogEntry, formatLogEntry } from '../domain/implementation-log.ts'
import { isDone } from '../domain/workflow.ts'
import type { PrismaClient } from '../db/client.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { badRequest, notFound } from '../http/errors.ts'
import type {
  LogEntryCreate,
  WorkItemCreate,
  WorkItemDetailDto,
  WorkItemDto,
  WorkItemFilters,
  WorkItemUpdate,
} from '../schemas/work-items.ts'
import {
  assertDateOrder,
  inputDate,
  nextPosition,
  requireProject,
  requireStory,
  resolveDate,
  resolveHours,
} from './common.ts'
import { toContainerRef, toTimeEntryDto, toWorkItemDto, WORK_ITEM_ROW_OMIT } from './mappers.ts'

/** Ordre hiérarchique : phase, epic, story, puis position de l'élément. */
const HIERARCHY_ORDER: Prisma.WorkItemOrderByWithRelationInput[] = [
  { story: { epic: { phase: { position: 'asc' } } } },
  { story: { epic: { position: 'asc' } } },
  { story: { position: 'asc' } },
  { position: 'asc' },
  { id: 'asc' },
]

/** Heures saisies par WorkItem (somme des TimeEntry). */
export async function spentHoursByWorkItem(
  prisma: PrismaClient,
  where: Prisma.TimeEntryWhereInput,
): Promise<Map<number, number>> {
  const groups = await prisma.timeEntry.groupBy({ by: ['workItemId'], where, _sum: { hours: true } })
  return new Map(groups.map((group) => [group.workItemId, group._sum.hours ?? 0]))
}

/** Codes « PHASE 1 / EPIC 2 / STORY 2.1 » du projet. */
export async function loadHierarchyCodes(prisma: PrismaClient, projectId: number) {
  const phases = await prisma.phase.findMany({
    where: { projectId },
    select: { id: true, position: true, epics: { select: { id: true, position: true, stories: { select: { id: true, position: true } } } } },
  })
  return computeCodes(phases)
}

async function nextWorkItemPosition(prisma: PrismaClient, storyId: number): Promise<number> {
  const max = await prisma.workItem.aggregate({ where: { storyId }, _max: { position: true } })
  return nextPosition(max._max.position)
}

function searchFilter(q: string | undefined): Prisma.WorkItemWhereInput | undefined {
  const query = q?.trim()
  if (!query) return undefined
  const id = /^#?(\d+)$/.exec(query)?.[1]
  return { OR: [{ title: { contains: query } }, ...(id ? [{ id: Number(id) }] : [])] }
}

export async function listProjectWorkItems(
  prisma: PrismaClient,
  projectId: number,
  filters: WorkItemFilters,
): Promise<WorkItemDto[]> {
  const project = await requireProject(prisma, projectId)
  const where: Prisma.WorkItemWhereInput = {
    projectId,
    ...(filters.type && { type: { in: filters.type } }),
    ...(filters.status && { status: { in: filters.status } }),
    ...(filters.storyId !== undefined && { storyId: filters.storyId }),
    ...((filters.epicId !== undefined || filters.phaseId !== undefined) && {
      story: {
        ...(filters.epicId !== undefined && { epicId: filters.epicId }),
        ...(filters.phaseId !== undefined && { epic: { phaseId: filters.phaseId } }),
      },
    }),
    ...searchFilter(filters.q),
  }
  const [items, spent] = await Promise.all([
    prisma.workItem.findMany({ where, omit: WORK_ITEM_ROW_OMIT, orderBy: HIERARCHY_ORDER }),
    spentHoursByWorkItem(prisma, { workItem: { projectId } }),
  ])
  return items.map((item) => toWorkItemDto(item, spent.get(item.id) ?? 0, project.hoursPerDay))
}

export async function listStoryWorkItems(prisma: PrismaClient, storyId: number): Promise<WorkItemDto[]> {
  const story = await requireStory(prisma, storyId)
  const [items, spent] = await Promise.all([
    prisma.workItem.findMany({ where: { storyId }, omit: WORK_ITEM_ROW_OMIT, orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
    spentHoursByWorkItem(prisma, { workItem: { storyId } }),
  ])
  const hoursPerDay = story.epic.phase.project.hoursPerDay
  return items.map((item) => toWorkItemDto(item, spent.get(item.id) ?? 0, hoursPerDay))
}

export async function getWorkItemDetail(prisma: PrismaClient, workItemId: number): Promise<WorkItemDetailDto> {
  const item = await prisma.workItem.findUnique({
    where: { id: workItemId },
    include: {
      project: true,
      story: { include: { epic: { include: { phase: true } } } },
      timeEntries: { orderBy: [{ spentOn: 'desc' }, { id: 'desc' }] },
      commitLinks: { include: { commit: true }, orderBy: { commit: { committedAt: 'desc' } } },
    },
  })
  if (!item) throw notFound(`Élément #${workItemId} introuvable`)

  const { project, story, timeEntries, commitLinks } = item
  const { epic } = story
  const codes = await loadHierarchyCodes(prisma, project.id)
  const spentHours = sumHours(timeEntries.map((entry) => entry.hours))

  return {
    ...toWorkItemDto(item, spentHours, project.hoursPerDay),
    description: item.description,
    implementationLog: item.implementationLog,
    project: { id: project.id, name: project.name, hoursPerDay: project.hoursPerDay },
    path: {
      phase: toContainerRef(epic.phase, codes.phases),
      epic: toContainerRef(epic, codes.epics),
      story: toContainerRef(story, codes.stories),
    },
    timeEntries: timeEntries.map((entry) => toTimeEntryDto(entry, project.hoursPerDay)),
    commits: commitLinks.map(({ commit, keyword }) => ({
      hash: commit.hash,
      shortHash: commit.hash.slice(0, 7),
      message: commit.message,
      authorName: commit.authorName,
      authorEmail: commit.authorEmail,
      committedAt: commit.committedAt.toISOString(),
      branch: commit.branch,
      keyword,
    })),
  }
}

export async function createWorkItem(
  prisma: PrismaClient,
  storyId: number,
  input: WorkItemCreate,
): Promise<WorkItemDetailDto> {
  const story = await requireStory(prisma, storyId)
  const project = story.epic.phase.project
  const startDate = inputDate(input.startDate ?? null)
  const dueDate = inputDate(input.dueDate ?? null)
  assertDateOrder(startDate, dueDate)
  const status = input.status ?? 'OPEN'

  const item = await prisma.workItem.create({
    data: {
      projectId: project.id,
      storyId,
      type: input.type,
      status,
      priority: input.priority ?? 'NORMAL',
      title: input.title.trim(),
      description: input.description ?? '',
      implementationLog: input.implementationLog ?? '',
      estimatedHours: resolveHours(input.estimatedHours, input.estimatedDays, project.hoursPerDay, 'estimated') ?? null,
      progress: input.progress ?? (isDone(status) ? 100 : 0),
      position: input.position ?? (await nextWorkItemPosition(prisma, storyId)),
      startDate,
      dueDate,
    },
  })
  return getWorkItemDetail(prisma, item.id)
}

export async function updateWorkItem(
  prisma: PrismaClient,
  workItemId: number,
  input: WorkItemUpdate,
): Promise<WorkItemDetailDto> {
  const current = await prisma.workItem.findUnique({ where: { id: workItemId }, include: { project: true } })
  if (!current) throw notFound(`Élément #${workItemId} introuvable`)

  const startDate = resolveDate(input.startDate, current.startDate)
  const dueDate = resolveDate(input.dueDate, current.dueDate)
  assertDateOrder(startDate, dueDate)

  const data: Prisma.WorkItemUncheckedUpdateInput = { startDate, dueDate }
  if (input.type !== undefined) data.type = input.type
  if (input.title !== undefined) data.title = input.title.trim()
  if (input.priority !== undefined) data.priority = input.priority
  if (input.description !== undefined) data.description = input.description
  if (input.implementationLog !== undefined) data.implementationLog = input.implementationLog
  if (input.position !== undefined) data.position = input.position
  if (input.status !== undefined) {
    data.status = input.status
    // Passer à Résolue / Terminée vaut 100 % d'avancement, sauf avancement explicite.
    if (isDone(input.status) && input.progress === undefined) data.progress = 100
  }
  if (input.progress !== undefined) data.progress = input.progress
  const estimatedHours = resolveHours(input.estimatedHours, input.estimatedDays, current.project.hoursPerDay, 'estimated')
  if (estimatedHours !== undefined) data.estimatedHours = estimatedHours

  if (input.storyId !== undefined && input.storyId !== current.storyId) {
    const target = await prisma.story.findUnique({ where: { id: input.storyId }, include: { epic: { include: { phase: true } } } })
    if (!target) throw badRequest(`Story #${input.storyId} introuvable`)
    if (target.epic.phase.projectId !== current.projectId) {
      throw badRequest(`La story #${input.storyId} appartient à un autre projet`)
    }
    data.storyId = target.id
    if (input.position === undefined) data.position = await nextWorkItemPosition(prisma, target.id)
  }

  await prisma.workItem.update({ where: { id: workItemId }, data })
  return getWorkItemDetail(prisma, workItemId)
}

export async function deleteWorkItem(prisma: PrismaClient, workItemId: number): Promise<void> {
  const item = await prisma.workItem.findUnique({ where: { id: workItemId }, select: { id: true } })
  if (!item) throw notFound(`Élément #${workItemId} introuvable`)
  await prisma.workItem.delete({ where: { id: workItemId } })
}

/** Ajoute une entrée horodatée (fuseau `timeZone`) en fin de journal d'avancement. */
export async function addLogEntry(
  prisma: PrismaClient,
  workItemId: number,
  input: LogEntryCreate,
  timeZone: string,
): Promise<WorkItemDetailDto> {
  const item = await prisma.workItem.findUnique({ where: { id: workItemId }, select: { implementationLog: true } })
  if (!item) throw notFound(`Élément #${workItemId} introuvable`)
  const text = input.text.trim()
  if (text === '') throw badRequest('Le texte de l’entrée est vide')

  const entry = formatLogEntry({ text, at: input.at ? new Date(input.at) : new Date(), hours: input.hours ?? null }, timeZone)
  await prisma.workItem.update({
    where: { id: workItemId },
    data: { implementationLog: appendLogEntry(item.implementationLog, entry) },
  })
  return getWorkItemDetail(prisma, workItemId)
}
