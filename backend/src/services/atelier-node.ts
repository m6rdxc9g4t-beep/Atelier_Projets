// Actions du nœud Atelier (docs/SUITE.md §7) : entrées snake_case → appels des services existants (aucune
// règle métier ici) → sorties snake_case. Tables : jeux de services/exports.ts au format atelier-table/1.
import { snakeKeys } from '../domain/snake-case.ts'
import type { Db } from '../db/client.ts'
import { badRequest } from '../http/errors.ts'
import type {
  AtelierTableDto,
  NodeLogEntry,
  NodeTimeEntry,
  NodeWorkItemCreate,
  NodeWorkItemUpdate,
  WorkItemsQueryInput,
} from '../schemas/atelier.ts'
import { ATELIER_TABLE_FORMAT } from '../schemas/atelier.ts'
import type { DatasetName } from '../schemas/exports.ts'
import { inputTimestamp, requireProject } from './common.ts'
import { getDataset } from './exports.ts'
import { listProjects } from './projects.ts'
import { getProjectTree } from './reports.ts'
import { createTimeEntry } from './time-entries.ts'
import { addLogEntryText, createWorkItem, getWorkItemDetail, listProjectWorkItems, updateWorkItem } from './work-items.ts'
import { reachMilestone } from './milestones.ts'

type Json = Record<string, unknown>
const snake = (value: unknown): Json => snakeKeys(value) as Json

export interface NodeClock {
  timeZone: string
  now: Date
}

// --- Lectures ----------------------------------------------------------------------------------------

export async function nodeListProjects(db: Db): Promise<Json[]> {
  return (await listProjects(db)).map(snake)
}

export async function nodeProjectTree(db: Db, projectId: number): Promise<Json> {
  return snake(await getProjectTree(db, projectId, {}))
}

export async function nodeGetWorkItem(db: Db, workItemId: number): Promise<Json> {
  return snake(await getWorkItemDetail(db, workItemId))
}

/** Jeu de données de Projets (§4.3) → atelier-table/1 (même colonnes, mêmes lignes). */
export async function nodeTable(db: Db, name: DatasetName, projectId: number | undefined, now: Date): Promise<AtelierTableDto> {
  const dataset = await getDataset(db, name, projectId === undefined ? {} : { projectId }, now)
  return toAtelierTable(dataset)
}

function toAtelierTable(dataset: Awaited<ReturnType<typeof getDataset>>, rows = dataset.rows): AtelierTableDto {
  return { format: ATELIER_TABLE_FORMAT, name: dataset.name, label: dataset.label, columns: dataset.columns, rows, total: rows.length, truncated: false }
}

/**
 * Éléments d'un projet (filtres de l'API : statut, type, story, recherche ; plus updated_since) au format
 * atelier-table/1, avec les colonnes du jeu « work-items » : le filtrage est celui de listProjectWorkItems.
 */
export async function nodeListWorkItems(db: Db, projectId: number, query: WorkItemsQueryInput, now: Date): Promise<AtelierTableDto> {
  const since = query.updated_since === undefined ? null : inputTimestamp(query.updated_since, 'updated_since')
  const items = await listProjectWorkItems(db, projectId, {
    ...(query.status && { status: query.status }),
    ...(query.type && { type: query.type }),
    ...(query.story_id !== undefined && { storyId: query.story_id }),
    ...(query.q !== undefined && { q: query.q }),
  })
  const order = new Map(
    items.filter((item) => since === null || new Date(item.updatedAt) >= since).map((item, index) => [item.id, index] as const),
  )
  const dataset = await getDataset(db, 'work-items', { projectId }, now)
  const rows = dataset.rows
    .filter((row) => order.has(row.id as number))
    .sort((a, b) => (order.get(a.id as number) ?? 0) - (order.get(b.id as number) ?? 0))
  return toAtelierTable(dataset, rows)
}

export async function nodeListMilestones(db: Db, projectId: number, now: Date): Promise<AtelierTableDto> {
  await requireProject(db, projectId)
  return nodeTable(db, 'milestones', projectId, now)
}

// --- Écritures ---------------------------------------------------------------------------------------

export async function nodeCreateWorkItem(db: Db, storyId: number, input: NodeWorkItemCreate, now: Date): Promise<Json> {
  const item = await createWorkItem(
    db,
    storyId,
    {
      type: input.type,
      title: input.title,
      ...(input.status !== undefined && { status: input.status }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.estimated_hours !== undefined && { estimatedHours: input.estimated_hours }),
      ...(input.due_date !== undefined && { dueDate: input.due_date }),
      ...(input.start_date !== undefined && { startDate: input.start_date }),
    },
    now,
  )
  return snake(item)
}

export async function nodeUpdateWorkItem(db: Db, workItemId: number, input: NodeWorkItemUpdate, now: Date): Promise<Json> {
  if (Object.keys(input).length === 0) throw badRequest('Aucun champ à modifier (status, progress, priority, due_date, title)')
  const item = await updateWorkItem(
    db,
    workItemId,
    {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.progress !== undefined && { progress: input.progress }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.due_date !== undefined && { dueDate: input.due_date }),
      ...(input.title !== undefined && { title: input.title }),
    },
    now,
  )
  return snake(item)
}

export async function nodeLogWorkItem(db: Db, workItemId: number, input: NodeLogEntry, clock: NodeClock): Promise<Json> {
  return snake(
    await addLogEntryText(
      db,
      workItemId,
      { text: input.text, ...(input.at !== undefined && { at: input.at }), ...(input.hours !== undefined && { hours: input.hours }) },
      clock,
    ),
  )
}

export async function nodeCreateTimeEntry(db: Db, workItemId: number, input: NodeTimeEntry, clock: NodeClock): Promise<Json> {
  return snake(
    await createTimeEntry(
      db,
      workItemId,
      { hours: input.hours, ...(input.spent_on !== undefined && { spentOn: input.spent_on }), ...(input.comment !== undefined && { comment: input.comment }) },
      clock,
    ),
  )
}

export async function nodeReachMilestone(db: Db, milestoneId: number, reachedAt: string | undefined, now: Date): Promise<Json> {
  return snake(await reachMilestone(db, milestoneId, reachedAt, now))
}
