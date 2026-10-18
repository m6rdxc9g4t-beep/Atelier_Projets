// Planification du Gantt : dépendances entre éléments, décalage d'un conteneur, résolution des conflits.
import { Type, type Static } from 'typebox'
import { DateOnly, Id, Nullable, StatusSchema, StrictObject, WorkItemTypeSchema } from './common.ts'

export const DependencyRefSchema = Type.Object(
  {
    id: Id,
    type: WorkItemTypeSchema,
    title: Type.String(),
    status: StatusSchema,
    slackDays: Nullable(
      Type.Integer({ description: 'Marge en jours : 0 = enchaînement serré, négative = conflit, null si non planifié' }),
    ),
  },
  { description: 'Élément lié par une dépendance « fin → début »' },
)
export type DependencyRefDto = Static<typeof DependencyRefSchema>

export const ProjectDependencySchema = Type.Object({
  predecessorId: Id,
  successorId: Id,
  slackDays: Nullable(Type.Integer()),
  conflict: Type.Boolean({ description: 'Le successeur commence avant la fin du prédécesseur' }),
})
export type ProjectDependencyDto = Static<typeof ProjectDependencySchema>

export const DependencyCreateSchema = StrictObject(
  { predecessorId: Type.Integer({ minimum: 1, maximum: 2_147_483_647, description: 'Élément qui doit finir avant celui-ci' }) },
  { description: 'Ajoute un prédécesseur (même projet, sans cycle)' },
)
export type DependencyCreate = Static<typeof DependencyCreateSchema>

export const DependencyParams = Type.Object({ workItemId: Id, predecessorId: Id })

export const ShiftSchema = StrictObject(
  {
    days: Type.Integer({
      minimum: -3650,
      maximum: 3650,
      not: { const: 0 },
      description: 'Décalage en jours (négatif = plus tôt) appliqué au conteneur, à son contenu daté et à ses jalons',
    }),
  },
  { description: 'Déplacement d’une barre de Gantt (phase, epic ou story) avec tout son contenu' },
)
export type ShiftInput = Static<typeof ShiftSchema>

export const ShiftResultSchema = Type.Object({
  workItems: Type.Integer({ description: 'Éléments décalés' }),
  containers: Type.Integer({ description: 'Phases, epics et stories décalés' }),
  milestones: Type.Integer({ description: 'Jalons décalés' }),
})
export type ShiftResultDto = Static<typeof ShiftResultSchema>

export const ResolveResultSchema = Type.Object(
  {
    moved: Type.Array(Type.Object({ id: Id, startDate: DateOnly, dueDate: DateOnly })),
  },
  { description: 'Éléments replanifiés pour respecter leurs dépendances (durées conservées)' },
)
export type ResolveResultDto = Static<typeof ResolveResultSchema>
