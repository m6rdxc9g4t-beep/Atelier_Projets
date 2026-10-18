// Vues calculées par le backend : dashboard, arborescence (Gantt / hiérarchie) et tableau des temps.
import { Type, type Static } from 'typebox'
import { MAX_HOURS_PER_DAY } from '../domain/durations.ts'
import {
  BalanceSchema,
  ContainerRefSchema,
  DateSpanSchema,
  DurationSchema,
  Id,
  Nullable,
  StatusCountsSchema,
  StatusSchema,
  TypeCountsSchema,
  WorkItemTypeSchema,
} from './common.ts'
import { EpicSchema, PhaseSchema, StorySchema } from './hierarchy.ts'
import { MilestoneSchema } from './milestones.ts'
import { ProjectSchema } from './projects.ts'
import { WorkItemSchema } from './work-items.ts'

export const ReportQuery = Type.Object({
  hoursPerDay: Type.Optional(
    Type.Number({
      exclusiveMinimum: 0,
      maximum: MAX_HOURS_PER_DAY,
      description: 'Surcharge, pour cette vue, du paramètre « 1 jour = X heures » du projet',
    }),
  ),
})
export type ReportOptions = Static<typeof ReportQuery>

export const AggregateSchema = Type.Object(
  {
    status: StatusSchema,
    progress: Type.Number({ description: 'Avancement pondéré par les estimations, en %' }),
    estimate: DurationSchema,
    spent: DurationSchema,
    workItems: Type.Integer(),
    statusCounts: StatusCountsSchema,
  },
  { description: 'Agrégat calculé à partir des WorkItems contenus' },
)

export const DashboardSchema = Type.Object(
  {
    project: ProjectSchema,
    hoursPerDay: Type.Number(),
    budget: Type.Object({
      initial: Nullable(DurationSchema),
      spent: DurationSchema,
      remaining: Nullable(DurationSchema),
      balance: Nullable(
        Type.Object(BalanceSchema.properties, {
          description: 'Solde du budget initial : REMAINING (reste à consommer) ou OVER (dépassement), delta ≥ 0 ; null sans budget',
        }),
      ),
      consumedPercent: Nullable(Type.Number({ description: 'Temps réalisé / budget initial, en %' })),
    }),
    progress: Type.Object({
      percent: Type.Number({ description: 'Avancement réel : Σ(estimation × avancement) / Σ estimations' }),
      planned: DurationSchema,
      earned: DurationSchema,
    }),
    trend: Nullable(Type.Enum(['AHEAD', 'ON_TRACK', 'BEHIND'], { type: 'string', description: 'null sans budget initial' })),
    workItems: Type.Object({ total: Type.Integer(), done: Type.Integer(), donePercent: Nullable(Type.Number()) }),
    histogram: Type.Array(Type.Object({ status: StatusSchema, total: Type.Integer(), byType: TypeCountsSchema }), {
      description: 'Les 8 statuts dans l’ordre du workflow',
    }),
  },
  { description: 'Santé du projet & budget, histogramme des statuts' },
)
export type DashboardDto = Static<typeof DashboardSchema>

const Code = Type.String({ description: 'Numérotation affichée (PHASE 1, EPIC 2, STORY 2.1)' })

export const TreeWorkItemSchema = Type.Object({ ...WorkItemSchema.properties, span: Nullable(DateSpanSchema) })
export const TreeStorySchema = Type.Object({
  ...StorySchema.properties,
  code: Code,
  span: Nullable(DateSpanSchema),
  aggregate: AggregateSchema,
  workItems: Type.Array(TreeWorkItemSchema),
})
export const TreeEpicSchema = Type.Object({
  ...EpicSchema.properties,
  code: Code,
  span: Nullable(DateSpanSchema),
  aggregate: AggregateSchema,
  stories: Type.Array(TreeStorySchema),
})
export const TreePhaseSchema = Type.Object({
  ...PhaseSchema.properties,
  code: Code,
  span: Nullable(DateSpanSchema),
  aggregate: AggregateSchema,
  epics: Type.Array(TreeEpicSchema),
  milestones: Type.Array(MilestoneSchema),
})

export const ProjectTreeSchema = Type.Object(
  {
    project: ProjectSchema,
    hoursPerDay: Type.Number(),
    range: Nullable(DateSpanSchema),
    aggregate: AggregateSchema,
    phases: Type.Array(TreePhaseSchema),
    milestones: Type.Array(MilestoneSchema, { description: 'Jalons de niveau projet (sans phase)' }),
  },
  { description: 'Arborescence complète avec agrégats et plages de dates (Gantt & hiérarchie)' },
)
export type ProjectTreeDto = Static<typeof ProjectTreeSchema>
export type TreePhaseDto = Static<typeof TreePhaseSchema>
export type TreeEpicDto = Static<typeof TreeEpicSchema>
export type TreeStoryDto = Static<typeof TreeStorySchema>
export type AggregateDto = Static<typeof AggregateSchema>

export const TimesheetQuery = Type.Object({
  ...ReportQuery.properties,
  phaseId: Type.Optional(Id),
  epicId: Type.Optional(Id),
  storyId: Type.Optional(Id),
  type: Type.Optional(Type.Array(WorkItemTypeSchema)),
  status: Type.Optional(Type.Array(StatusSchema)),
})
export type TimesheetFilters = Static<typeof TimesheetQuery>

export const TimesheetSchema = Type.Object(
  {
    hoursPerDay: Type.Number(),
    rows: Type.Array(
      Type.Object({
        id: Id,
        type: WorkItemTypeSchema,
        title: Type.String(),
        status: StatusSchema,
        path: Type.Object({ phase: ContainerRefSchema, epic: ContainerRefSchema, story: ContainerRefSchema }),
        estimate: Nullable(DurationSchema),
        spent: DurationSchema,
        balance: Nullable(BalanceSchema),
      }),
    ),
    totals: Type.Object({
      count: Type.Integer(),
      done: Type.Integer(),
      donePercent: Nullable(Type.Number({ description: 'Part des éléments terminés ou résolus, en %' })),
      estimate: DurationSchema,
      spent: DurationSchema,
      remaining: Type.Object(DurationSchema.properties, { description: 'Σ estimations − Σ réalisé (négatif = dépassement)' }),
      balance: Type.Object(BalanceSchema.properties, {
        description: 'Solde global : REMAINING (reste à consommer) ou OVER (dépassement), delta ≥ 0',
      }),
    }),
  },
  { description: 'Tableau des temps : budget, réalisé et bilan par élément' },
)
export type TimesheetDto = Static<typeof TimesheetSchema>
