// Saisies de temps (« + Saisir Temps ») : en heures, sur un jour calendaire.
import { todayDateOnly } from '../domain/dates.ts'
import { roundTo } from '../domain/durations.ts'
import type { Db } from '../db/client.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { notFound } from '../http/errors.ts'
import type { TimeEntryCreate, TimeEntryDto, TimeEntryUpdate } from '../schemas/time-entries.ts'
import { inputDate } from './common.ts'
import { toTimeEntryDto } from './mappers.ts'
import { emitEvents, timeEntryEvent } from './atelier-events.ts'

async function requireWorkItemProject(prisma: Db, workItemId: number) {
  const item = await prisma.workItem.findUnique({
    where: { id: workItemId },
    select: { id: true, projectId: true, title: true, project: { select: { hoursPerDay: true } } },
  })
  if (!item) throw notFound(`Élément #${workItemId} introuvable`)
  return item
}

async function requireTimeEntry(prisma: Db, timeEntryId: number) {
  const entry = await prisma.timeEntry.findUnique({
    where: { id: timeEntryId },
    include: { workItem: { select: { project: { select: { hoursPerDay: true } } } } },
  })
  if (!entry) throw notFound(`Saisie de temps #${timeEntryId} introuvable`)
  return entry
}

export async function listTimeEntries(prisma: Db, workItemId: number): Promise<TimeEntryDto[]> {
  const item = await requireWorkItemProject(prisma, workItemId)
  const entries = await prisma.timeEntry.findMany({ where: { workItemId }, orderBy: [{ spentOn: 'desc' }, { id: 'desc' }] })
  return entries.map((entry) => toTimeEntryDto(entry, item.project.hoursPerDay))
}

export async function createTimeEntry(
  prisma: Db,
  workItemId: number,
  input: TimeEntryCreate,
  clock: { timeZone: string; now: Date },
): Promise<TimeEntryDto> {
  const item = await requireWorkItemProject(prisma, workItemId)
  const spentOn = inputDate(input.spentOn ?? todayDateOnly(clock.timeZone, clock.now))
  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.timeEntry.create({
      data: { workItemId, spentOn, hours: roundTo(input.hours, 2), comment: input.comment?.trim() ?? '' },
    })
    await emitEvents(tx, [timeEntryEvent(item, created)], clock.now)
    return created
  })
  return toTimeEntryDto(entry, item.project.hoursPerDay)
}

export async function updateTimeEntry(
  prisma: Db,
  timeEntryId: number,
  input: TimeEntryUpdate,
): Promise<TimeEntryDto> {
  const current = await requireTimeEntry(prisma, timeEntryId)
  const data: Prisma.TimeEntryUpdateInput = {}
  if (input.hours !== undefined) data.hours = roundTo(input.hours, 2)
  if (input.spentOn !== undefined) data.spentOn = inputDate(input.spentOn)
  if (input.comment !== undefined) data.comment = input.comment.trim()
  const entry = await prisma.timeEntry.update({ where: { id: timeEntryId }, data })
  return toTimeEntryDto(entry, current.workItem.project.hoursPerDay)
}

export async function deleteTimeEntry(prisma: Db, timeEntryId: number): Promise<void> {
  await requireTimeEntry(prisma, timeEntryId)
  await prisma.timeEntry.delete({ where: { id: timeEntryId } })
}
