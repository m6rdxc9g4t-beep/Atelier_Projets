// Chronomètre : un seul en cours pour toute l'application ; à l'arrêt, il devient une saisie de temps.
import { Type, type Static } from 'typebox'
import { DateTime, Id, Nullable, StrictObject, WorkItemTypeSchema } from './common.ts'
import { TimeEntrySchema } from './time-entries.ts'

export const RunningTimerSchema = Type.Object(
  {
    workItemId: Id,
    projectId: Id,
    type: WorkItemTypeSchema,
    title: Type.String(),
    startedAt: DateTime,
    elapsedSeconds: Type.Integer({ description: 'Secondes écoulées au moment de la réponse' }),
  },
  { description: 'Chronomètre en cours' },
)
export type RunningTimerDto = Static<typeof RunningTimerSchema>

export const TimerStateSchema = Type.Object({ timer: Nullable(RunningTimerSchema) })
export type TimerStateDto = Static<typeof TimerStateSchema>

export const TimerStartSchema = StrictObject(
  { workItemId: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }) },
  { description: 'Démarre le chronomètre sur un élément ; un chronomètre en cours sur un autre élément est d’abord arrêté et saisi' },
)
export type TimerStart = Static<typeof TimerStartSchema>

export const TimerStopSchema = StrictObject({ comment: Type.Optional(Type.String({ maxLength: 2000 })) })
export type TimerStop = Static<typeof TimerStopSchema>

export const TimerStopResultSchema = Type.Object(
  {
    workItemId: Id,
    timeEntry: TimeEntrySchema,
    capped: Type.Boolean({ description: 'Durée ramenée à 24 h (maximum d’une saisie)' }),
  },
  { description: 'Saisie de temps créée à l’arrêt du chronomètre' },
)
export type TimerStopResultDto = Static<typeof TimerStopResultSchema>

export const TimerStartResultSchema = Type.Object({
  timer: RunningTimerSchema,
  stopped: Nullable(TimerStopResultSchema),
})
export type TimerStartResultDto = Static<typeof TimerStartResultSchema>
