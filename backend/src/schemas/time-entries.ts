import { Type, type Static } from 'typebox'
import { DateOnly, DateTime, DurationSchema, Id, StrictObject } from './common.ts'

export const TimeEntrySchema = Type.Object(
  {
    id: Id,
    workItemId: Id,
    spentOn: DateOnly,
    duration: DurationSchema,
    comment: Type.String(),
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { description: 'Saisie de temps sur un élément' },
)
export type TimeEntryDto = Static<typeof TimeEntrySchema>

const EntryHours = Type.Number({ exclusiveMinimum: 0, maximum: 24, description: 'Heures passées (> 0 et ≤ 24)' })
const Comment = Type.String({ maxLength: 2000 })

export const TimeEntryCreateSchema = StrictObject(
  { hours: EntryHours, spentOn: Type.Optional(DateOnly), comment: Type.Optional(Comment) },
  { description: 'spentOn vaut la date du jour si absent' },
)
export type TimeEntryCreate = Static<typeof TimeEntryCreateSchema>

export const TimeEntryUpdateSchema = StrictObject({
  hours: Type.Optional(EntryHours),
  spentOn: Type.Optional(DateOnly),
  comment: Type.Optional(Comment),
})
export type TimeEntryUpdate = Static<typeof TimeEntryUpdateSchema>

export const TimeEntryParams = Type.Object({ timeEntryId: Id })
