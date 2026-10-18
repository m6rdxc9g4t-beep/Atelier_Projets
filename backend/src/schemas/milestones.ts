import { Type, type Static } from 'typebox'
import { DateOnly, DateTime, Id, Markdown, Nullable, NullableInput, StrictObject, Title } from './common.ts'

export const MilestoneSchema = Type.Object(
  {
    id: Id,
    projectId: Id,
    phaseId: Nullable(Id),
    title: Type.String(),
    description: Type.String(),
    date: DateOnly,
    reachedAt: Nullable(DateTime),
    reached: Type.Boolean(),
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { description: 'Jalon (◆ sur le Gantt) ; phaseId null = jalon de niveau projet' },
)
export type MilestoneDto = Static<typeof MilestoneSchema>

export const MilestoneCreateSchema = StrictObject({
  title: Title,
  date: DateOnly,
  description: Type.Optional(Markdown),
  phaseId: Type.Optional(NullableInput(Id)),
  reachedAt: Type.Optional(NullableInput(DateTime)),
})
export type MilestoneCreate = Static<typeof MilestoneCreateSchema>

export const MilestoneUpdateSchema = StrictObject({
  title: Type.Optional(Title),
  date: Type.Optional(DateOnly),
  description: Type.Optional(Markdown),
  phaseId: Type.Optional(NullableInput(Id)),
  reachedAt: Type.Optional(NullableInput(DateTime)),
})
export type MilestoneUpdate = Static<typeof MilestoneUpdateSchema>

export const MilestoneParams = Type.Object({ milestoneId: Id })
