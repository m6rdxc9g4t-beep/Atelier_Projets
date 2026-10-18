// Conteneurs de la hiérarchie : Phase > Epic > Story.
import { Type, type Static } from 'typebox'
import { DateOnly, DateTime, Id, Markdown, Nullable, NullableInput, Position, StrictObject, Title } from './common.ts'

const containerFields = {
  title: Type.String(),
  description: Type.String(),
  position: Type.Integer(),
  startDate: Nullable(DateOnly),
  dueDate: Nullable(DateOnly),
  createdAt: DateTime,
  updatedAt: DateTime,
}

export const PhaseSchema = Type.Object({ id: Id, projectId: Id, ...containerFields }, { description: 'Phase du projet' })
export const EpicSchema = Type.Object({ id: Id, phaseId: Id, ...containerFields }, { description: 'Epic d’une phase' })
export const StorySchema = Type.Object({ id: Id, epicId: Id, ...containerFields }, { description: 'Story d’un epic' })
export type PhaseDto = Static<typeof PhaseSchema>
export type EpicDto = Static<typeof EpicSchema>
export type StoryDto = Static<typeof StorySchema>

const containerInput = {
  description: Type.Optional(Markdown),
  position: Type.Optional(Position),
  startDate: Type.Optional(NullableInput(DateOnly)),
  dueDate: Type.Optional(NullableInput(DateOnly)),
}

/** Création d'une phase, d'un epic ou d'une story (ajouté(e) en fin de liste si position est absente). */
export const ContainerCreateSchema = StrictObject({ title: Title, ...containerInput })
export type ContainerCreate = Static<typeof ContainerCreateSchema>

export const PhaseUpdateSchema = StrictObject({ title: Type.Optional(Title), ...containerInput })
export const EpicUpdateSchema = StrictObject({
  title: Type.Optional(Title),
  phaseId: Type.Optional(Type.Integer({ minimum: 1, description: 'Déplace l’epic vers une autre phase du même projet' })),
  ...containerInput,
})
export const StoryUpdateSchema = StrictObject({
  title: Type.Optional(Title),
  epicId: Type.Optional(Type.Integer({ minimum: 1, description: 'Déplace la story vers un autre epic du même projet' })),
  ...containerInput,
})
export type PhaseUpdate = Static<typeof PhaseUpdateSchema>
export type EpicUpdate = Static<typeof EpicUpdateSchema>
export type StoryUpdate = Static<typeof StoryUpdateSchema>

export const PhaseParams = Type.Object({ phaseId: Id })
export const EpicParams = Type.Object({ epicId: Id })
export const StoryParams = Type.Object({ storyId: Id })
