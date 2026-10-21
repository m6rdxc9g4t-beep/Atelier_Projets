// Vues calculées (CLAUDE.md §1 : les agrégations viennent du backend) :
// - dashboard : santé du budget, avancement réel, tendance, histogramme des 8 statuts ;
// - arborescence : Phase > Epic > Story > WorkItem avec agrégats et plages de dates (Gantt, hiérarchie) ;
// - tableau des temps : budget, réalisé et bilan par élément, avec totaux.
import { aggregate, progressSummary, type AggregatableItem } from '../domain/aggregates.ts'
import { computeEnvelopeBalance, computeTrend } from '../domain/balance.ts'
import { toCsv } from '../domain/csv.ts'
import { formatDateOnly } from '../domain/dates.ts'
import { percentOf, sumHours, toDuration, toDurationOrNull } from '../domain/durations.ts'
import { computeCodes, effectiveSpan, enclosingSpan, type DateSpan } from '../domain/hierarchy.ts'
import { emptyTypeCounts, isDone, isRejected, WORK_ITEM_STATUSES } from '../domain/workflow.ts'
import type { Db } from '../db/client.ts'
import type { Epic, Milestone, Phase, Project, Story } from '../generated/prisma/client.ts'
import type {
  AggregateDto,
  DashboardDto,
  ProjectTreeDto,
  ReportOptions,
  TimesheetDto,
  TimesheetFilters,
  TreePhaseDto,
} from '../schemas/reports.ts'
import { requireProject } from './common.ts'
import {
  toBalanceDto,
  toContainerRef,
  toEpicDto,
  toMilestoneDto,
  toPhaseDto,
  toProjectDto,
  toStoryDto,
  toWorkItemDto,
  WORK_ITEM_ROW_OMIT,
  type WorkItemRow,
} from './mappers.ts'
import { projectSchedule } from './schedule.ts'
import { spentHoursByWorkItem } from './work-items.ts'

type PhaseTree = Phase & { epics: Array<Epic & { stories: Story[] }> }
type ItemWithSpent = WorkItemRow & AggregatableItem

/** Tout le projet en mémoire : hiérarchie ordonnée, éléments avec leur temps réalisé, jalons. */
interface ProjectSnapshot {
  project: Project
  phases: PhaseTree[]
  itemsByStory: Map<number, ItemWithSpent[]>
  items: ItemWithSpent[]
  milestones: Milestone[]
}

async function loadSnapshot(prisma: Db, projectId: number): Promise<ProjectSnapshot> {
  const project = await requireProject(prisma, projectId)
  const order = [{ position: 'asc' as const }, { id: 'asc' as const }]
  const [phases, rows, spent, milestones] = await Promise.all([
    prisma.phase.findMany({
      where: { projectId },
      orderBy: order,
      include: { epics: { orderBy: order, include: { stories: { orderBy: order } } } },
    }),
    prisma.workItem.findMany({ where: { projectId }, omit: WORK_ITEM_ROW_OMIT, orderBy: order }),
    spentHoursByWorkItem(prisma, { workItem: { projectId } }),
    prisma.milestone.findMany({ where: { projectId }, orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
  ])

  // rows est trié par (position, id) : chaque story garde l'ordre d'affichage de ses éléments.
  const items = rows.map((row) => ({ ...row, spentHours: spent.get(row.id) ?? 0 }))
  const itemsByStory = new Map<number, ItemWithSpent[]>()
  for (const item of items) {
    const siblings = itemsByStory.get(item.storyId)
    if (siblings) siblings.push(item)
    else itemsByStory.set(item.storyId, [item])
  }
  return { project, phases, itemsByStory, items, milestones }
}

function toAggregateDto(items: readonly AggregatableItem[], hoursPerDay: number): AggregateDto {
  const result = aggregate(items)
  return {
    status: result.status,
    progress: result.progress,
    estimate: toDuration(result.estimateHours, hoursPerDay),
    spent: toDuration(result.spentHours, hoursPerDay),
    workItems: result.workItems,
    statusCounts: result.statusCounts,
  }
}

function pointSpan(date: Date): DateSpan {
  const day = formatDateOnly(date)
  return { start: day, end: day }
}

// --- Dashboard -----------------------------------------------------------------------------------

export async function getDashboard(prisma: Db, projectId: number, options: ReportOptions): Promise<DashboardDto> {
  const { project, items } = await loadSnapshot(prisma, projectId)
  const hoursPerDay = options.hoursPerDay ?? project.hoursPerDay
  const spentHours = sumHours(items.map((item) => item.spentHours))
  const budgetHours = project.budgetHours
  const consumedPercent = budgetHours === null ? null : percentOf(spentHours, budgetHours)
  const progress = progressSummary(items)
  const done = items.filter((item) => isDone(item.status)).length
  const active = items.filter((item) => !isRejected(item.status)).length

  return {
    project: toProjectDto(project),
    hoursPerDay,
    budget: {
      initial: toDurationOrNull(budgetHours, hoursPerDay),
      spent: toDuration(spentHours, hoursPerDay),
      remaining: budgetHours === null ? null : toDuration(budgetHours - spentHours, hoursPerDay),
      balance: budgetHours === null ? null : toBalanceDto(computeEnvelopeBalance(budgetHours, spentHours), hoursPerDay),
      consumedPercent,
    },
    progress: {
      percent: progress.percent,
      planned: toDuration(progress.plannedHours, hoursPerDay),
      earned: toDuration(progress.earnedHours, hoursPerDay),
    },
    trend: consumedPercent === null ? null : computeTrend(progress.percent, consumedPercent),
    workItems: { total: items.length, done, donePercent: percentOf(done, active) },
    histogram: WORK_ITEM_STATUSES.map((status) => {
      const byType = emptyTypeCounts()
      for (const item of items) if (item.status === status) byType[item.type] += 1
      return { status, total: byType.FEATURE + byType.TASK + byType.BUG, byType }
    }),
  }
}

// --- Arborescence (Gantt & hiérarchie) -----------------------------------------------------------

export async function getProjectTree(prisma: Db, projectId: number, options: ReportOptions): Promise<ProjectTreeDto> {
  const { project, phases, itemsByStory, items, milestones } = await loadSnapshot(prisma, projectId)
  const hoursPerDay = options.hoursPerDay ?? project.hoursPerDay
  const codes = computeCodes(phases)

  const phaseNodes: TreePhaseDto[] = phases.map((phase) => {
    const phaseItems: ItemWithSpent[] = []
    const epics = phase.epics.map((epic) => {
      const epicItems: ItemWithSpent[] = []
      const stories = epic.stories.map((story) => {
        const storyItems = itemsByStory.get(story.id) ?? []
        epicItems.push(...storyItems)
        const workItems = storyItems.map((item) => ({
          ...toWorkItemDto(item, item.spentHours, hoursPerDay),
          span: effectiveSpan(item),
        }))
        return {
          ...toStoryDto(story),
          code: codes.stories.get(story.id) ?? '?',
          span: effectiveSpan(story, workItems.map((workItem) => workItem.span)),
          aggregate: toAggregateDto(storyItems, hoursPerDay),
          workItems,
        }
      })
      phaseItems.push(...epicItems)
      return {
        ...toEpicDto(epic),
        code: codes.epics.get(epic.id) ?? '?',
        span: effectiveSpan(epic, stories.map((story) => story.span)),
        aggregate: toAggregateDto(epicItems, hoursPerDay),
        stories,
      }
    })
    return {
      ...toPhaseDto(phase),
      code: codes.phases.get(phase.id) ?? '?',
      span: effectiveSpan(phase, epics.map((epic) => epic.span)),
      aggregate: toAggregateDto(phaseItems, hoursPerDay),
      epics,
      milestones: milestones.filter((milestone) => milestone.phaseId === phase.id).map(toMilestoneDto),
    }
  })

  const projectSpan = effectiveSpan(project, phaseNodes.map((phase) => phase.span))
  const schedule = await projectSchedule(prisma, projectId)
  return {
    project: toProjectDto(project),
    hoursPerDay,
    range: enclosingSpan([projectSpan, ...milestones.map((milestone) => pointSpan(milestone.date))]),
    aggregate: toAggregateDto(items, hoursPerDay),
    phases: phaseNodes,
    milestones: milestones.filter((milestone) => milestone.phaseId === null).map(toMilestoneDto),
    dependencies: schedule.dependencies,
    criticalPath: schedule.criticalPath,
  }
}

// --- Tableau des temps ---------------------------------------------------------------------------

export async function getTimesheet(prisma: Db, projectId: number, filters: TimesheetFilters): Promise<TimesheetDto> {
  const { project, phases, itemsByStory } = await loadSnapshot(prisma, projectId)
  const hoursPerDay = filters.hoursPerDay ?? project.hoursPerDay
  const codes = computeCodes(phases)
  const types = filters.type ? new Set(filters.type) : null
  const statuses = filters.status ? new Set(filters.status) : null

  const rows: TimesheetDto['rows'] = []
  const selected: ItemWithSpent[] = []
  for (const phase of phases) {
    if (filters.phaseId !== undefined && phase.id !== filters.phaseId) continue
    for (const epic of phase.epics) {
      if (filters.epicId !== undefined && epic.id !== filters.epicId) continue
      for (const story of epic.stories) {
        if (filters.storyId !== undefined && story.id !== filters.storyId) continue
        for (const item of itemsByStory.get(story.id) ?? []) {
          if (types && !types.has(item.type)) continue
          if (statuses && !statuses.has(item.status)) continue
          const dto = toWorkItemDto(item, item.spentHours, hoursPerDay)
          selected.push(item)
          rows.push({
            id: item.id,
            type: item.type,
            title: item.title,
            status: item.status,
            path: {
              phase: toContainerRef(phase, codes.phases),
              epic: toContainerRef(epic, codes.epics),
              story: toContainerRef(story, codes.stories),
            },
            estimate: dto.estimate,
            spent: dto.spent,
            balance: dto.balance,
          })
        }
      }
    }
  }

  const active = selected.filter((item) => !isRejected(item.status))
  const done = selected.filter((item) => isDone(item.status)).length
  const estimateHours = sumHours(active.map((item) => item.estimatedHours ?? 0))
  const spentHours = sumHours(selected.map((item) => item.spentHours))
  return {
    hoursPerDay,
    rows,
    totals: {
      count: rows.length,
      done,
      donePercent: percentOf(done, active.length),
      estimate: toDuration(estimateHours, hoursPerDay),
      spent: toDuration(spentHours, hoursPerDay),
      remaining: toDuration(estimateHours - spentHours, hoursPerDay),
      balance: toBalanceDto(computeEnvelopeBalance(estimateHours, spentHours), hoursPerDay),
    },
  }
}

// --- Export CSV du tableau des temps ---------------------------------------------------------------

const STATUS_FR: Record<string, string> = {
  OPEN: 'À faire',
  IN_PROGRESS: 'En cours',
  IN_REVIEW: 'En revue',
  ON_HOLD: 'En attente',
  BLOCKED: 'Bloquée',
  RESOLVED: 'Résolue',
  CLOSED: 'Terminée',
  REJECTED: 'Rejetée',
}
const BALANCE_FR: Record<string, string> = { UNDER: 'Sous le budget', ON_BUDGET: 'Dans le budget', OVER: 'Dépassement', REMAINING: 'Reste' }

/** Tableau des temps (mêmes filtres que la vue) au format CSV, avec une ligne de totaux. */
export async function getTimesheetCsv(
  prisma: Db,
  projectId: number,
  filters: TimesheetFilters,
  today: string,
): Promise<{ filename: string; content: string }> {
  const [sheet, project] = await Promise.all([getTimesheet(prisma, projectId, filters), requireProject(prisma, projectId)])
  const header = ['ID', 'Type', 'Titre', 'Statut', 'Phase', 'Epic', 'Story', 'Budget (j)', 'Réalisé (j)', 'Réalisé (h)', 'Bilan', 'Écart (j)']
  const rows = sheet.rows.map((row) => [
    `#${row.id}`,
    row.type,
    row.title,
    STATUS_FR[row.status] ?? row.status,
    `PHASE ${row.path.phase.code} ${row.path.phase.title}`,
    `EPIC ${row.path.epic.code} ${row.path.epic.title}`,
    `STORY ${row.path.story.code} ${row.path.story.title}`,
    row.estimate?.days ?? null,
    row.spent.days,
    row.spent.hours,
    row.balance ? (BALANCE_FR[row.balance.kind] ?? row.balance.kind) : null,
    row.balance ? row.balance.delta.days : null,
  ])
  const { totals } = sheet
  rows.push([
    'TOTAL',
    `${totals.count} éléments`,
    '',
    totals.donePercent === null ? '' : `${totals.donePercent} % terminé/résolu`,
    '',
    '',
    '',
    totals.estimate.days,
    totals.spent.days,
    totals.spent.hours,
    BALANCE_FR[totals.balance.kind] ?? totals.balance.kind,
    totals.balance.delta.days,
  ])
  return { filename: `temps-${project.slug ?? `projet-${project.id}`}-${today}.csv`, content: toCsv(header, rows) }
}
