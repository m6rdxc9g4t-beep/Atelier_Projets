// Entités Prisma → DTO de l'API (dates en chaînes, durées en heures + jours, bilans calculés).
import { computeBalance } from '../domain/balance.ts'
import { formatDateOnly, formatDateOnlyOrNull } from '../domain/dates.ts'
import { toDuration, toDurationOrNull } from '../domain/durations.ts'
import type { Epic, Milestone, Phase, Project, Story, TimeEntry, WorkItem } from '../generated/prisma/client.ts'
import type { ContainerRefSchema } from '../schemas/common.ts'
import type { EpicDto, PhaseDto, StoryDto } from '../schemas/hierarchy.ts'
import type { MilestoneDto } from '../schemas/milestones.ts'
import type { ProjectDto } from '../schemas/projects.ts'
import type { TimeEntryDto } from '../schemas/time-entries.ts'
import type { WorkItemDto } from '../schemas/work-items.ts'
import type { Static } from 'typebox'

/** WorkItem sans ses deux textes Markdown (listes, arborescence, tableau des temps). */
export type WorkItemRow = Omit<WorkItem, 'description' | 'implementationLog'>
export const WORK_ITEM_ROW_OMIT = { description: true, implementationLog: true } as const

export function toProjectDto(project: Project): ProjectDto {
  const { githubOwner: owner, githubRepo: repo } = project
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    localRepoPath: project.localRepoPath,
    github: owner && repo ? { owner, repo, url: `https://github.com/${owner}/${repo}` } : null,
    defaultBranch: project.defaultBranch,
    hoursPerDay: project.hoursPerDay,
    budget: toDurationOrNull(project.budgetHours, project.hoursPerDay),
    startDate: formatDateOnlyOrNull(project.startDate),
    dueDate: formatDateOnlyOrNull(project.dueDate),
    gitScannedAt: project.gitScannedAt?.toISOString() ?? null,
    githubSyncedAt: project.githubSyncedAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}

function containerFields(container: Phase | Epic | Story) {
  return {
    title: container.title,
    description: container.description,
    position: container.position,
    startDate: formatDateOnlyOrNull(container.startDate),
    dueDate: formatDateOnlyOrNull(container.dueDate),
    createdAt: container.createdAt.toISOString(),
    updatedAt: container.updatedAt.toISOString(),
  }
}

export function toPhaseDto(phase: Phase): PhaseDto {
  return { id: phase.id, projectId: phase.projectId, ...containerFields(phase) }
}

export function toEpicDto(epic: Epic): EpicDto {
  return { id: epic.id, phaseId: epic.phaseId, ...containerFields(epic) }
}

export function toStoryDto(story: Story): StoryDto {
  return { id: story.id, epicId: story.epicId, ...containerFields(story) }
}

export function toContainerRef(
  container: { id: number; title: string },
  codes: ReadonlyMap<number, string>,
): Static<typeof ContainerRefSchema> {
  return { id: container.id, code: codes.get(container.id) ?? '?', title: container.title }
}

export function toWorkItemDto(item: WorkItemRow, spentHours: number, hoursPerDay: number): WorkItemDto {
  const balance = computeBalance({ status: item.status, estimatedHours: item.estimatedHours, spentHours })
  return {
    id: item.id,
    projectId: item.projectId,
    storyId: item.storyId,
    type: item.type,
    status: item.status,
    priority: item.priority,
    title: item.title,
    progress: item.progress,
    position: item.position,
    startDate: formatDateOnlyOrNull(item.startDate),
    dueDate: formatDateOnlyOrNull(item.dueDate),
    estimate: toDurationOrNull(item.estimatedHours, hoursPerDay),
    spent: toDuration(spentHours, hoursPerDay),
    balance: balance === null ? null : { kind: balance.kind, delta: toDuration(balance.deltaHours, hoursPerDay) },
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}

export function toTimeEntryDto(entry: TimeEntry, hoursPerDay: number): TimeEntryDto {
  return {
    id: entry.id,
    workItemId: entry.workItemId,
    spentOn: formatDateOnly(entry.spentOn),
    duration: toDuration(entry.hours, hoursPerDay),
    comment: entry.comment,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  }
}

export function toMilestoneDto(milestone: Milestone): MilestoneDto {
  return {
    id: milestone.id,
    projectId: milestone.projectId,
    phaseId: milestone.phaseId,
    title: milestone.title,
    description: milestone.description,
    date: formatDateOnly(milestone.date),
    reachedAt: milestone.reachedAt?.toISOString() ?? null,
    reached: milestone.reachedAt !== null,
    createdAt: milestone.createdAt.toISOString(),
    updatedAt: milestone.updatedAt.toISOString(),
  }
}
