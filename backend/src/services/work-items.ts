// WorkItems : liste filtrée, fiche complète (double onglet, temps, commits), écriture, déplacement
// entre stories du même projet, et ajout d'entrées horodatées au journal d'avancement.
import { sumHours } from '../domain/durations.ts'
import { computeCodes } from '../domain/hierarchy.ts'
import { appendLogEntry, formatLogEntry } from '../domain/implementation-log.ts'
import { isDone, type WorkItemStatus, type WorkItemType } from '../domain/workflow.ts'
import type { Db } from '../db/client.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { badRequest, notFound } from '../http/errors.ts'
import { MARKDOWN_MAX_LENGTH } from '../schemas/common.ts'
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
  inputTimestamp,
  nextPosition,
  requireProject,
  requireStory,
  resolveDate,
  resolveHours,
} from './common.ts'
import type { ReportOptions } from '../schemas/reports.ts'
import { toLinkedPullRequests } from './git.ts'
import { workItemDependencies } from './schedule.ts'
import { toContainerRef, toTimeEntryDto, toWorkItemDto, WORK_ITEM_ROW_OMIT } from './mappers.ts'
import { emitEvents, nodeEvent, ref, type NodeEvent } from './atelier-events.ts'
import { toSnakeKey } from '../domain/snake-case.ts'

/** Ordre hiérarchique (identique à l'arborescence) : à chaque niveau, position puis id. */
const HIERARCHY_ORDER: Prisma.WorkItemOrderByWithRelationInput[] = [
  { story: { epic: { phase: { position: 'asc' } } } },
  { story: { epic: { phase: { id: 'asc' } } } },
  { story: { epic: { position: 'asc' } } },
  { story: { epic: { id: 'asc' } } },
  { story: { position: 'asc' } },
  { story: { id: 'asc' } },
  { position: 'asc' },
  { id: 'asc' },
]

/** Un élément RESOLVED / CLOSED est à 100 % : toute autre valeur fournie est une contradiction (400). */
function progressFor(status: WorkItemStatus, progress: number | undefined): number | undefined {
  if (isDone(status)) {
    if (progress !== undefined && progress !== 100) {
      throw badRequest('Un élément RESOLVED ou CLOSED est à 100 % d’avancement')
    }
    return 100
  }
  return progress
}

/** Heures saisies par WorkItem (somme des TimeEntry). */
export async function spentHoursByWorkItem(
  prisma: Db,
  where: Prisma.TimeEntryWhereInput,
): Promise<Map<number, number>> {
  const groups = await prisma.timeEntry.groupBy({ by: ['workItemId'], where, _sum: { hours: true } })
  return new Map(groups.map((group) => [group.workItemId, group._sum.hours ?? 0]))
}

/** Codes « PHASE 1 / EPIC 2 / STORY 2.1 » du projet. */
export async function loadHierarchyCodes(prisma: Db, projectId: number) {
  const phases = await prisma.phase.findMany({
    where: { projectId },
    select: { id: true, position: true, epics: { select: { id: true, position: true, stories: { select: { id: true, position: true } } } } },
  })
  return computeCodes(phases)
}

async function nextWorkItemPosition(prisma: Db, storyId: number): Promise<number> {
  const max = await prisma.workItem.aggregate({ where: { storyId }, _max: { position: true } })
  return nextPosition(max._max.position)
}

/** Texte comparable : minuscules, sans accents. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr')
}

/**
 * Recherche « q » : dans le titre, sans tenir compte de la casse ni des accents, ou par #ID.
 * Faite en mémoire (projet local) : pas de jokers LIKE (% et _ sont des caractères ordinaires).
 */
function matchesQuery(q: string | undefined): (item: { id: number; title: string }) => boolean {
  const query = q?.trim() ?? ''
  if (query === '') return () => true
  const needle = normalize(query)
  const id = /^#?(\d+)$/.exec(query)?.[1]
  return (item) => normalize(item.title).includes(needle) || (id !== undefined && item.id === Number(id))
}

export async function listProjectWorkItems(
  prisma: Db,
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
  }
  const [items, spent] = await Promise.all([
    prisma.workItem.findMany({ where, omit: WORK_ITEM_ROW_OMIT, orderBy: HIERARCHY_ORDER }),
    spentHoursByWorkItem(prisma, { workItem: { projectId } }),
  ])
  return items
    .filter(matchesQuery(filters.q))
    .map((item) => toWorkItemDto(item, spent.get(item.id) ?? 0, project.hoursPerDay))
}

export async function listStoryWorkItems(prisma: Db, storyId: number): Promise<WorkItemDto[]> {
  const story = await requireStory(prisma, storyId)
  const [items, spent] = await Promise.all([
    prisma.workItem.findMany({ where: { storyId }, omit: WORK_ITEM_ROW_OMIT, orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
    spentHoursByWorkItem(prisma, { workItem: { storyId } }),
  ])
  const hoursPerDay = story.epic.phase.project.hoursPerDay
  return items.map((item) => toWorkItemDto(item, spent.get(item.id) ?? 0, hoursPerDay))
}

export async function getWorkItemDetail(
  prisma: Db,
  workItemId: number,
  options: ReportOptions = {},
): Promise<WorkItemDetailDto> {
  const item = await prisma.workItem.findUnique({
    where: { id: workItemId },
    include: {
      project: true,
      story: { include: { epic: { include: { phase: true } } } },
      timeEntries: { orderBy: [{ spentOn: 'desc' }, { id: 'desc' }] },
      commitLinks: { include: { commit: true }, orderBy: { commit: { committedAt: 'desc' } } },
      pullRequestLinks: { include: { pullRequest: true } },
    },
  })
  if (!item) throw notFound(`Élément #${workItemId} introuvable`)

  const { project, story, timeEntries, commitLinks, pullRequestLinks } = item
  const { epic } = story
  const codes = await loadHierarchyCodes(prisma, project.id)
  const spentHours = sumHours(timeEntries.map((entry) => entry.hours))
  const hoursPerDay = options.hoursPerDay ?? project.hoursPerDay

  return {
    ...toWorkItemDto(item, spentHours, hoursPerDay),
    description: item.description,
    implementationLog: item.implementationLog,
    project: { id: project.id, name: project.name, hoursPerDay: project.hoursPerDay },
    path: {
      phase: toContainerRef(epic.phase, codes.phases),
      epic: toContainerRef(epic, codes.epics),
      story: toContainerRef(story, codes.stories),
    },
    timeEntries: timeEntries.map((entry) => toTimeEntryDto(entry, hoursPerDay)),
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
    pullRequests: toLinkedPullRequests(pullRequestLinks),
    ...(await workItemDependencies(prisma, item.id)),
  }
}

/** Données d'un nouvel élément, validées (dates, statut / avancement, estimation convertie en heures). */
function newWorkItemData(project: { id: number; hoursPerDay: number }, storyId: number, input: WorkItemCreate) {
  const startDate = inputDate(input.startDate ?? null)
  const dueDate = inputDate(input.dueDate ?? null)
  assertDateOrder(startDate, dueDate)
  const status = input.status ?? 'OPEN'
  return {
    projectId: project.id,
    storyId,
    type: input.type,
    status,
    priority: input.priority ?? 'NORMAL',
    title: input.title.trim(),
    description: input.description ?? '',
    implementationLog: input.implementationLog ?? '',
    estimatedHours: resolveHours(input.estimatedHours, input.estimatedDays, project.hoursPerDay, 'estimated') ?? null,
    progress: progressFor(status, input.progress) ?? 0,
    startDate,
    dueDate,
  }
}

/** Événement « élément créé » (docs/SUITE.md §7.3). */
function createdEvent(item: { id: number; projectId: number; storyId: number; type: WorkItemType; status: WorkItemStatus; title: string }): NodeEvent {
  return nodeEvent(
    'projets.work_item.created',
    { kind: 'work_item', id: ref(item.id), label: item.title },
    { project_id: ref(item.projectId), story_id: ref(item.storyId), type: item.type, status: item.status },
  )
}

export async function createWorkItem(
  prisma: Db,
  storyId: number,
  input: WorkItemCreate,
  now: Date = new Date(),
): Promise<WorkItemDetailDto> {
  const story = await requireStory(prisma, storyId)
  const data = newWorkItemData(story.epic.phase.project, storyId, input)
  const id = await prisma.$transaction(async (tx) => {
    const item = await tx.workItem.create({
      data: { ...data, position: input.position ?? (await nextWorkItemPosition(tx, storyId)) },
    })
    await emitEvents(tx, [createdEvent(item)], now)
    return item.id
  })
  return getWorkItemDetail(prisma, id)
}

/**
 * Crée plusieurs éléments dans une story, en fin de liste et dans l'ordre donné, en une seule transaction :
 * tous sont créés ou aucun (découpage proposé par l'IA, saisie en lot).
 */
export async function createWorkItems(prisma: Db, storyId: number, inputs: WorkItemCreate[], now: Date = new Date()): Promise<WorkItemDto[]> {
  const story = await requireStory(prisma, storyId)
  const rows = inputs.map((input) => ({ input, data: newWorkItemData(story.epic.phase.project, storyId, input) }))
  const ids = await prisma.$transaction(async (tx) => {
    const max = await tx.workItem.aggregate({ where: { storyId }, _max: { position: true } })
    let position = nextPosition(max._max.position)
    const created: Awaited<ReturnType<typeof tx.workItem.create>>[] = []
    for (const { input, data } of rows) {
      const item = await tx.workItem.create({ data: { ...data, position: input.position ?? position } })
      position = Math.max(position, item.position) + 1
      created.push(item)
    }
    // Un événement « créé » par élément, dans la transaction du lot (tout ou rien).
    await emitEvents(tx, created.map(createdEvent), now)
    return created.map((item) => item.id)
  })
  const all = await listStoryWorkItems(prisma, storyId)
  return ids.map((id) => all.find((item) => item.id === id)).filter((item): item is WorkItemDto => item !== undefined)
}

/** Champs réellement changés (noms en snake_case, comme les propriétés du nœud Atelier). */
function changedFields(current: Record<string, unknown>, data: Record<string, unknown>): string[] {
  const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b)
  return Object.entries(data)
    .filter(([key, value]) => value !== undefined && !same(current[key], value))
    .map(([key]) => toSnakeKey(key))
}

/** Événements d'une modification : « modifié » (champs changés) et, si le statut change, « statut changé ». */
export function updateEvents(
  item: { id: number; projectId: number; title: string },
  fields: string[],
  status?: { from: WorkItemStatus; to: WorkItemStatus },
): NodeEvent[] {
  if (fields.length === 0) return []
  const subject = { kind: 'work_item' as const, id: ref(item.id), label: item.title }
  return [
    ...(status && status.from !== status.to
      ? [nodeEvent('projets.work_item.status_changed', subject, { project_id: ref(item.projectId), from: status.from, to: status.to })]
      : []),
    nodeEvent('projets.work_item.updated', subject, { project_id: ref(item.projectId), fields }),
  ]
}

export async function updateWorkItem(
  prisma: Db,
  workItemId: number,
  input: WorkItemUpdate,
  now: Date = new Date(),
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
  if (input.status !== undefined) data.status = input.status
  // Résolu / terminé ⇒ 100 % ; rouvrir un élément conserve son avancement, sauf valeur fournie.
  const progress = progressFor(input.status ?? current.status, input.progress)
  if (progress !== undefined) data.progress = progress
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

  const fields = changedFields(current, data)
  await prisma.$transaction(async (tx) => {
    const updated = await tx.workItem.update({ where: { id: workItemId }, data })
    await emitEvents(tx, updateEvents(updated, fields, { from: current.status, to: updated.status }), now)
  })
  return getWorkItemDetail(prisma, workItemId)
}

/** Événements « supprimé » des éléments qui vont disparaître (directement ou avec leur conteneur). */
export async function deletedEvents(prisma: Db, where: Prisma.WorkItemWhereInput): Promise<NodeEvent[]> {
  const items = await prisma.workItem.findMany({ where, select: { id: true, projectId: true, title: true }, orderBy: { id: 'asc' } })
  return items.map((item) =>
    nodeEvent('projets.work_item.deleted', { kind: 'work_item', id: ref(item.id), label: item.title }, { project_id: ref(item.projectId) }),
  )
}

/**
 * Supprime un conteneur (projet, phase, epic, story) et émet « élément supprimé » pour chaque élément emporté,
 * dans la même transaction.
 */
export async function deleteWithItems(prisma: Db, where: Prisma.WorkItemWhereInput, remove: (tx: Db) => Promise<unknown>, now: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const events = await deletedEvents(tx, where)
    await remove(tx)
    await emitEvents(tx, events, now)
  })
}

export async function deleteWorkItem(prisma: Db, workItemId: number, now: Date = new Date()): Promise<void> {
  const item = await prisma.workItem.findUnique({ where: { id: workItemId }, select: { id: true } })
  if (!item) throw notFound(`Élément #${workItemId} introuvable`)
  await deleteWithItems(prisma, { id: workItemId }, (tx) => tx.workItem.delete({ where: { id: workItemId } }), now)
}

/**
 * Ajoute une entrée horodatée (heure lue dans `clock.timeZone`) en fin de journal d'avancement.
 * Lecture et écriture dans une même transaction : deux ajouts simultanés (ex. ai-bridge) ne s'écrasent pas.
 */
export async function addLogEntry(
  prisma: Db,
  workItemId: number,
  input: LogEntryCreate,
  clock: { timeZone: string; now: Date },
): Promise<WorkItemDetailDto> {
  const text = input.text.trim()
  if (text === '') throw badRequest('Le texte de l’entrée est vide')
  const at = input.at === undefined ? clock.now : inputTimestamp(input.at, 'at')
  const entry = formatLogEntry({ text, at, hours: input.hours ?? null }, clock.timeZone)

  await appendLogEntryIn(prisma, workItemId, entry, clock.now)
  return getWorkItemDetail(prisma, workItemId)
}

/** Ajout atomique d'une entrée déjà formatée (lecture et écriture dans une transaction) + événement « modifié ». */
async function appendLogEntryIn(prisma: Db, workItemId: number, entry: string, now: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const item = await tx.workItem.findUnique({ where: { id: workItemId }, select: { implementationLog: true } })
    if (!item) throw notFound(`Élément #${workItemId} introuvable`)
    const implementationLog = appendLogEntry(item.implementationLog, entry)
    if (implementationLog.length > MARKDOWN_MAX_LENGTH) {
      throw badRequest(`Le journal dépasserait ${MARKDOWN_MAX_LENGTH.toLocaleString('fr-FR')} caractères`)
    }
    const updated = await tx.workItem.update({ where: { id: workItemId }, data: { implementationLog } })
    await emitEvents(tx, updateEvents(updated, ['implementation_log']), now)
  })
}

/**
 * Entrée de journal pour le nœud Atelier : même règle que addLogEntry, mais renvoie l'entrée ajoutée
 * (et pas toute la fiche, qui contient le journal complet).
 */
export async function addLogEntryText(
  prisma: Db,
  workItemId: number,
  input: LogEntryCreate,
  clock: { timeZone: string; now: Date },
): Promise<{ workItemId: number; at: string; entry: string }> {
  const text = input.text.trim()
  if (text === '') throw badRequest('Le texte de l’entrée est vide')
  const at = input.at === undefined ? clock.now : inputTimestamp(input.at, 'at')
  const entry = formatLogEntry({ text, at, hours: input.hours ?? null }, clock.timeZone)
  await appendLogEntryIn(prisma, workItemId, entry, clock.now)
  return { workItemId, at: at.toISOString(), entry }
}
