// Jalons : toujours rattachés à un projet, et optionnellement à une phase de ce même projet.
import type { PrismaClient } from '../db/client.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { badRequest, notFound } from '../http/errors.ts'
import type { MilestoneCreate, MilestoneDto, MilestoneUpdate } from '../schemas/milestones.ts'
import { inputDate, inputTimestamp, requireProject } from './common.ts'
import { toMilestoneDto } from './mappers.ts'

async function assertPhaseOfProject(prisma: PrismaClient, phaseId: number, projectId: number): Promise<void> {
  const phase = await prisma.phase.findUnique({ where: { id: phaseId }, select: { projectId: true } })
  if (!phase) throw badRequest(`Phase #${phaseId} introuvable`)
  if (phase.projectId !== projectId) throw badRequest(`La phase #${phaseId} appartient à un autre projet`)
}

/** Date d'atteinte : un jalon ne peut pas avoir été atteint dans le futur (tolérance d'horloge : 5 min). */
function reachedAt(value: string | null | undefined, now: Date): Date | null {
  if (value === undefined || value === null) return null
  return inputTimestamp(value, 'reachedAt', { notAfter: new Date(now.getTime() + 5 * 60_000) })
}

async function requireMilestone(prisma: PrismaClient, milestoneId: number) {
  const milestone = await prisma.milestone.findUnique({ where: { id: milestoneId } })
  if (!milestone) throw notFound(`Jalon #${milestoneId} introuvable`)
  return milestone
}

export async function listMilestones(prisma: PrismaClient, projectId: number): Promise<MilestoneDto[]> {
  await requireProject(prisma, projectId)
  const milestones = await prisma.milestone.findMany({ where: { projectId }, orderBy: [{ date: 'asc' }, { id: 'asc' }] })
  return milestones.map(toMilestoneDto)
}

export async function createMilestone(
  prisma: PrismaClient,
  projectId: number,
  input: MilestoneCreate,
  now: Date,
): Promise<MilestoneDto> {
  await requireProject(prisma, projectId)
  const phaseId = input.phaseId ?? null
  if (phaseId !== null) await assertPhaseOfProject(prisma, phaseId, projectId)
  const milestone = await prisma.milestone.create({
    data: {
      projectId,
      phaseId,
      title: input.title.trim(),
      description: input.description ?? '',
      date: inputDate(input.date),
      reachedAt: reachedAt(input.reachedAt, now),
    },
  })
  return toMilestoneDto(milestone)
}

export async function getMilestone(prisma: PrismaClient, milestoneId: number): Promise<MilestoneDto> {
  return toMilestoneDto(await requireMilestone(prisma, milestoneId))
}

export async function updateMilestone(
  prisma: PrismaClient,
  milestoneId: number,
  input: MilestoneUpdate,
  now: Date,
): Promise<MilestoneDto> {
  const current = await requireMilestone(prisma, milestoneId)
  const data: Prisma.MilestoneUncheckedUpdateInput = {}
  if (input.phaseId !== undefined) {
    if (input.phaseId !== null) await assertPhaseOfProject(prisma, input.phaseId, current.projectId)
    data.phaseId = input.phaseId
  }
  if (input.title !== undefined) data.title = input.title.trim()
  if (input.description !== undefined) data.description = input.description
  if (input.date !== undefined) data.date = inputDate(input.date)
  if (input.reachedAt !== undefined) data.reachedAt = reachedAt(input.reachedAt, now)
  return toMilestoneDto(await prisma.milestone.update({ where: { id: milestoneId }, data }))
}

export async function deleteMilestone(prisma: PrismaClient, milestoneId: number): Promise<void> {
  await requireMilestone(prisma, milestoneId)
  await prisma.milestone.delete({ where: { id: milestoneId } })
}
