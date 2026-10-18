// Chronomètre : au plus un en cours (ligne unique id = 1). L'arrêter crée une saisie de temps sur l'élément
// (durée arrondie au centième d'heure, au moins 0,01 h, au plus 24 h ; jour = jour du démarrage).
import { roundTo } from '../domain/durations.ts'
import { todayDateOnly } from '../domain/dates.ts'
import type { PrismaClient } from '../db/client.ts'
import { badRequest, notFound } from '../http/errors.ts'
import type {
  RunningTimerDto,
  TimerStart,
  TimerStartResultDto,
  TimerStateDto,
  TimerStop,
  TimerStopResultDto,
} from '../schemas/timer.ts'
import { toTimeEntryDto } from './mappers.ts'

export interface Clock {
  timeZone: string
  now: Date
}

const TIMER_ID = 1
const MAX_HOURS = 24

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

async function loadTimer(prisma: PrismaClient | Tx) {
  return prisma.runningTimer.findUnique({
    where: { id: TIMER_ID },
    include: { workItem: { select: { id: true, projectId: true, type: true, title: true } } },
  })
}

function toDto(timer: NonNullable<Awaited<ReturnType<typeof loadTimer>>>, now: Date): RunningTimerDto {
  return {
    workItemId: timer.workItem.id,
    projectId: timer.workItem.projectId,
    type: timer.workItem.type,
    title: timer.workItem.title,
    startedAt: timer.startedAt.toISOString(),
    elapsedSeconds: Math.max(0, Math.floor((now.getTime() - timer.startedAt.getTime()) / 1000)),
  }
}

export async function getTimer(prisma: PrismaClient, clock: Clock): Promise<TimerStateDto> {
  const timer = await loadTimer(prisma)
  return { timer: timer ? toDto(timer, clock.now) : null }
}

/** Démarre le chronomètre (en une transaction : le chronomètre en cours sur un autre élément est arrêté et saisi). */
export async function startTimer(prisma: PrismaClient, input: TimerStart, clock: Clock): Promise<TimerStartResultDto> {
  return prisma.$transaction(async (tx) => {
    const item = await tx.workItem.findUnique({ where: { id: input.workItemId }, select: { id: true } })
    if (!item) throw notFound(`Élément #${input.workItemId} introuvable`)
    const current = await loadTimer(tx)
    if (current?.workItem.id === item.id) return { timer: toDto(current, clock.now), stopped: null }
    const stopped = current ? await stopIn(tx, {}, clock) : null
    await tx.runningTimer.upsert({
      where: { id: TIMER_ID },
      create: { id: TIMER_ID, workItemId: item.id, startedAt: clock.now },
      update: { workItemId: item.id, startedAt: clock.now, comment: '' },
    })
    const timer = await loadTimer(tx)
    return { timer: toDto(timer as NonNullable<typeof timer>, clock.now), stopped }
  })
}

/** Arrête le chronomètre et saisit le temps écoulé, en une transaction. */
export async function stopTimer(prisma: PrismaClient, input: TimerStop, clock: Clock): Promise<TimerStopResultDto> {
  return prisma.$transaction((tx) => stopIn(tx, input, clock))
}

async function stopIn(tx: Tx, input: TimerStop, clock: Clock): Promise<TimerStopResultDto> {
  {
    const timer = await tx.runningTimer.findUnique({
      where: { id: TIMER_ID },
      include: { workItem: { select: { id: true, project: { select: { hoursPerDay: true } } } } },
    })
    if (!timer) throw badRequest('Aucun chronomètre en cours')
    const elapsedHours = Math.max(0, clock.now.getTime() - timer.startedAt.getTime()) / 3_600_000
    const capped = elapsedHours > MAX_HOURS
    const hours = Math.max(0.01, roundTo(Math.min(elapsedHours, MAX_HOURS), 2))
    const spentOn = new Date(`${todayDateOnly(clock.timeZone, timer.startedAt)}T00:00:00Z`)
    const entry = await tx.timeEntry.create({
      data: { workItemId: timer.workItem.id, spentOn, hours, comment: input.comment?.trim() || 'Chronomètre' },
    })
    await tx.runningTimer.delete({ where: { id: TIMER_ID } })
    return { workItemId: timer.workItem.id, timeEntry: toTimeEntryDto(entry, timer.workItem.project.hoursPerDay), capped }
  }
}

/** Abandonne le chronomètre sans rien saisir. */
export async function discardTimer(prisma: PrismaClient): Promise<void> {
  const deleted = await prisma.runningTimer.deleteMany({ where: { id: TIMER_ID } })
  if (deleted.count === 0) throw badRequest('Aucun chronomètre en cours')
}
