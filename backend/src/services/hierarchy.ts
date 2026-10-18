// Conteneurs de la hiérarchie : Phases (d'un projet), Epics (d'une phase), Stories (d'un epic).
// Un epic ou une story peut être déplacé(e), mais uniquement à l'intérieur du même projet.
import type { PrismaClient } from '../db/client.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { badRequest } from '../http/errors.ts'
import type {
  ContainerCreate,
  EpicDto,
  EpicUpdate,
  PhaseDto,
  PhaseUpdate,
  StoryDto,
  StoryUpdate,
} from '../schemas/hierarchy.ts'
import {
  assertDateOrder,
  inputDate,
  nextPosition,
  requireEpic,
  requirePhase,
  requireProject,
  requireStory,
  resolveDate,
} from './common.ts'
import { toEpicDto, toPhaseDto, toStoryDto } from './mappers.ts'

const ORDER = [{ position: 'asc' }, { id: 'asc' }] as const satisfies Prisma.PhaseOrderByWithRelationInput[]

interface Dated {
  startDate: Date | null
  dueDate: Date | null
}

/** Champs communs d'une création : titre nettoyé, description, dates contrôlées. */
function createFields(input: ContainerCreate) {
  const startDate = inputDate(input.startDate ?? null)
  const dueDate = inputDate(input.dueDate ?? null)
  assertDateOrder(startDate, dueDate)
  return { title: input.title.trim(), description: input.description ?? '', startDate, dueDate }
}

/** Champs communs d'une modification partielle (dates contrôlées avec les valeurs existantes). */
function updateFields(input: PhaseUpdate, current: Dated) {
  const startDate = resolveDate(input.startDate, current.startDate)
  const dueDate = resolveDate(input.dueDate, current.dueDate)
  assertDateOrder(startDate, dueDate)
  return {
    startDate,
    dueDate,
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.position !== undefined && { position: input.position }),
  }
}

// --- Phases --------------------------------------------------------------------------------------

export async function listPhases(prisma: PrismaClient, projectId: number): Promise<PhaseDto[]> {
  await requireProject(prisma, projectId)
  const phases = await prisma.phase.findMany({ where: { projectId }, orderBy: [...ORDER] })
  return phases.map(toPhaseDto)
}

export async function createPhase(prisma: PrismaClient, projectId: number, input: ContainerCreate): Promise<PhaseDto> {
  await requireProject(prisma, projectId)
  const max = await prisma.phase.aggregate({ where: { projectId }, _max: { position: true } })
  const phase = await prisma.phase.create({
    data: { projectId, ...createFields(input), position: input.position ?? nextPosition(max._max.position) },
  })
  return toPhaseDto(phase)
}

export async function getPhase(prisma: PrismaClient, phaseId: number): Promise<PhaseDto> {
  return toPhaseDto(await requirePhase(prisma, phaseId))
}

export async function updatePhase(prisma: PrismaClient, phaseId: number, input: PhaseUpdate): Promise<PhaseDto> {
  const current = await requirePhase(prisma, phaseId)
  const phase = await prisma.phase.update({ where: { id: phaseId }, data: updateFields(input, current) })
  return toPhaseDto(phase)
}

/** Supprime la phase, ses epics, stories et éléments ; ses jalons restent rattachés au projet. */
export async function deletePhase(prisma: PrismaClient, phaseId: number): Promise<void> {
  await requirePhase(prisma, phaseId)
  await prisma.phase.delete({ where: { id: phaseId } })
}

// --- Epics ---------------------------------------------------------------------------------------

export async function listEpics(prisma: PrismaClient, phaseId: number): Promise<EpicDto[]> {
  await requirePhase(prisma, phaseId)
  const epics = await prisma.epic.findMany({ where: { phaseId }, orderBy: [...ORDER] })
  return epics.map(toEpicDto)
}

export async function createEpic(prisma: PrismaClient, phaseId: number, input: ContainerCreate): Promise<EpicDto> {
  await requirePhase(prisma, phaseId)
  const max = await prisma.epic.aggregate({ where: { phaseId }, _max: { position: true } })
  const epic = await prisma.epic.create({
    data: { phaseId, ...createFields(input), position: input.position ?? nextPosition(max._max.position) },
  })
  return toEpicDto(epic)
}

export async function getEpic(prisma: PrismaClient, epicId: number): Promise<EpicDto> {
  return toEpicDto(await requireEpic(prisma, epicId))
}

export async function updateEpic(prisma: PrismaClient, epicId: number, input: EpicUpdate): Promise<EpicDto> {
  const current = await requireEpic(prisma, epicId)
  const data: Prisma.EpicUncheckedUpdateInput = updateFields(input, current)

  if (input.phaseId !== undefined && input.phaseId !== current.phaseId) {
    const target = await prisma.phase.findUnique({ where: { id: input.phaseId } })
    if (!target) throw badRequest(`Phase #${input.phaseId} introuvable`)
    if (target.projectId !== current.phase.projectId) {
      throw badRequest(`La phase #${input.phaseId} appartient à un autre projet`)
    }
    data.phaseId = target.id
    if (input.position === undefined) {
      const max = await prisma.epic.aggregate({ where: { phaseId: target.id }, _max: { position: true } })
      data.position = nextPosition(max._max.position)
    }
  }

  return toEpicDto(await prisma.epic.update({ where: { id: epicId }, data }))
}

export async function deleteEpic(prisma: PrismaClient, epicId: number): Promise<void> {
  await requireEpic(prisma, epicId)
  await prisma.epic.delete({ where: { id: epicId } })
}

// --- Stories -------------------------------------------------------------------------------------

export async function listStories(prisma: PrismaClient, epicId: number): Promise<StoryDto[]> {
  await requireEpic(prisma, epicId)
  const stories = await prisma.story.findMany({ where: { epicId }, orderBy: [...ORDER] })
  return stories.map(toStoryDto)
}

export async function createStory(prisma: PrismaClient, epicId: number, input: ContainerCreate): Promise<StoryDto> {
  await requireEpic(prisma, epicId)
  const max = await prisma.story.aggregate({ where: { epicId }, _max: { position: true } })
  const story = await prisma.story.create({
    data: { epicId, ...createFields(input), position: input.position ?? nextPosition(max._max.position) },
  })
  return toStoryDto(story)
}

export async function getStory(prisma: PrismaClient, storyId: number): Promise<StoryDto> {
  return toStoryDto(await requireStory(prisma, storyId))
}

export async function updateStory(prisma: PrismaClient, storyId: number, input: StoryUpdate): Promise<StoryDto> {
  const current = await requireStory(prisma, storyId)
  const data: Prisma.StoryUncheckedUpdateInput = updateFields(input, current)

  if (input.epicId !== undefined && input.epicId !== current.epicId) {
    const target = await prisma.epic.findUnique({ where: { id: input.epicId }, include: { phase: true } })
    if (!target) throw badRequest(`Epic #${input.epicId} introuvable`)
    if (target.phase.projectId !== current.epic.phase.projectId) {
      throw badRequest(`L’epic #${input.epicId} appartient à un autre projet`)
    }
    data.epicId = target.id
    if (input.position === undefined) {
      const max = await prisma.story.aggregate({ where: { epicId: target.id }, _max: { position: true } })
      data.position = nextPosition(max._max.position)
    }
  }

  return toStoryDto(await prisma.story.update({ where: { id: storyId }, data }))
}

export async function deleteStory(prisma: PrismaClient, storyId: number): Promise<void> {
  await requireStory(prisma, storyId)
  await prisma.story.delete({ where: { id: storyId } })
}
