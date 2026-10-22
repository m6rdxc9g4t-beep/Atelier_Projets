// Jalons : toujours rattachés à un projet, et optionnellement à une phase de ce même projet.
import type { Db } from '../db/client.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { badRequest, notFound } from '../http/errors.ts'
import type { MilestoneCreate, MilestoneDto, MilestoneUpdate } from '../schemas/milestones.ts'
import { inputDate, inputTimestamp, requireProject } from './common.ts'
import { toMilestoneDto } from './mappers.ts'
import { emitEvents, nodeEvent, ref } from './atelier-events.ts'
import { formatDateOnly } from '../domain/dates.ts'
import type { Milestone } from '../generated/prisma/client.ts'

/** « Jalon atteint » quand reachedAt passe de null à une date (création déjà atteinte comprise). */
async function emitReached(db: Db, before: Date | null, milestone: Milestone, now: Date): Promise<void> {
  if (before !== null || milestone.reachedAt === null) return
  await emitEvents(
    db,
    [
      nodeEvent(
        'projets.milestone.reached',
        { kind: 'milestone', id: ref(milestone.id), label: milestone.title },
        { project_id: ref(milestone.projectId), date: formatDateOnly(milestone.date), reached_at: milestone.reachedAt.toISOString() },
      ),
    ],
    now,
  )
}

async function assertPhaseOfProject(prisma: Db, phaseId: number, projectId: number): Promise<void> {
  const phase = await prisma.phase.findUnique({ where: { id: phaseId }, select: { projectId: true } })
  if (!phase) throw badRequest(`Phase #${phaseId} introuvable`)
  if (phase.projectId !== projectId) throw badRequest(`La phase #${phaseId} appartient à un autre projet`)
}

/** Date d'atteinte : un jalon ne peut pas avoir été atteint dans le futur (tolérance d'horloge : 5 min). */
function reachedAt(value: string | null | undefined, now: Date): Date | null {
  if (value === undefined || value === null) return null
  return inputTimestamp(value, 'reachedAt', { notAfter: new Date(now.getTime() + 5 * 60_000) })
}

async function requireMilestone(prisma: Db, milestoneId: number) {
  const milestone = await prisma.milestone.findUnique({ where: { id: milestoneId } })
  if (!milestone) throw notFound(`Jalon #${milestoneId} introuvable`)
  return milestone
}

export async function listMilestones(prisma: Db, projectId: number): Promise<MilestoneDto[]> {
  await requireProject(prisma, projectId)
  const milestones = await prisma.milestone.findMany({ where: { projectId }, orderBy: [{ date: 'asc' }, { id: 'asc' }] })
  return milestones.map(toMilestoneDto)
}

export async function createMilestone(
  prisma: Db,
  projectId: number,
  input: MilestoneCreate,
  now: Date,
): Promise<MilestoneDto> {
  await requireProject(prisma, projectId)
  const phaseId = input.phaseId ?? null
  if (phaseId !== null) await assertPhaseOfProject(prisma, phaseId, projectId)
  const data = {
    projectId,
    phaseId,
    title: input.title.trim(),
    description: input.description ?? '',
    date: inputDate(input.date),
    reachedAt: reachedAt(input.reachedAt, now),
  }
  const milestone = await prisma.$transaction(async (tx) => {
    const created = await tx.milestone.create({ data })
    await emitReached(tx, null, created, now)
    return created
  })
  return toMilestoneDto(milestone)
}

export async function getMilestone(prisma: Db, milestoneId: number): Promise<MilestoneDto> {
  return toMilestoneDto(await requireMilestone(prisma, milestoneId))
}

export async function updateMilestone(
  prisma: Db,
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
  const milestone = await prisma.$transaction(async (tx) => {
    const updated = await tx.milestone.update({ where: { id: milestoneId }, data })
    await emitReached(tx, current.reachedAt, updated, now)
    return updated
  })
  return toMilestoneDto(milestone)
}

/**
 * Marque un jalon atteint (nœud Atelier, idempotence « naturelle ») : sans effet s'il l'est déjà
 * (date d'atteinte conservée, aucun événement) ; sinon reachedAt = date fournie ou maintenant.
 */
export async function reachMilestone(prisma: Db, milestoneId: number, at: string | undefined, now: Date): Promise<MilestoneDto> {
  const current = await requireMilestone(prisma, milestoneId)
  if (current.reachedAt !== null) return toMilestoneDto(current)
  return updateMilestone(prisma, milestoneId, { reachedAt: at ?? now.toISOString() }, now)
}

export async function deleteMilestone(prisma: Db, milestoneId: number): Promise<void> {
  await requireMilestone(prisma, milestoneId)
  await prisma.milestone.delete({ where: { id: milestoneId } })
}
