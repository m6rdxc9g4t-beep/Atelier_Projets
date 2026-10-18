// WorkItem (FEATURE | TASK | BUG) : liste, fiche détaillée (double onglet + commits), écriture, journal.
import { Type, type Static } from 'typebox'
import {
  BalanceSchema,
  ContainerRefSchema,
  DateOnly,
  DateTime,
  Days,
  DurationSchema,
  Hours,
  Id,
  Markdown,
  Nullable,
  NullableInput,
  Position,
  PrioritySchema,
  StatusSchema,
  StrictObject,
  Title,
  WorkItemTypeSchema,
} from './common.ts'
import { TimeEntrySchema } from './time-entries.ts'

const Progress = Type.Integer({ minimum: 0, maximum: 100, description: 'Avancement déclaré, en %' })

export const WorkItemSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1, description: '#ID public, cité dans les messages de commit' }),
    projectId: Id,
    storyId: Id,
    type: WorkItemTypeSchema,
    status: StatusSchema,
    priority: PrioritySchema,
    title: Type.String(),
    progress: Progress,
    position: Type.Integer(),
    startDate: Nullable(DateOnly),
    dueDate: Nullable(DateOnly),
    estimate: Nullable(DurationSchema),
    spent: DurationSchema,
    balance: Nullable(BalanceSchema),
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { description: 'Élément de travail (FEATURE, TASK ou BUG)' },
)
export type WorkItemDto = Static<typeof WorkItemSchema>

export const LinkedCommitSchema = Type.Object({
  hash: Type.String(),
  shortHash: Type.String(),
  message: Type.String(),
  authorName: Type.String(),
  authorEmail: Type.String(),
  committedAt: DateTime,
  branch: Nullable(Type.String()),
  keyword: Nullable(Type.String({ description: 'Mot-clé détecté : feature, task, bug, fix, feat, ref' })),
})
export type LinkedCommitDto = Static<typeof LinkedCommitSchema>

export const WorkItemDetailSchema = Type.Object(
  {
    ...WorkItemSchema.properties,
    description: Type.String({ description: 'Onglet 1 « Description (À faire) » — Markdown' }),
    implementationLog: Type.String({ description: 'Onglet 2 « Journal d’avancement » — Markdown horodaté' }),
    project: Type.Object({ id: Id, name: Type.String(), hoursPerDay: Type.Number() }),
    path: Type.Object({ phase: ContainerRefSchema, epic: ContainerRefSchema, story: ContainerRefSchema }),
    timeEntries: Type.Array(TimeEntrySchema),
    commits: Type.Array(LinkedCommitSchema),
  },
  { description: 'Fiche complète d’un élément (TaskSlideOver)' },
)
export type WorkItemDetailDto = Static<typeof WorkItemDetailSchema>

const workItemInput = {
  status: Type.Optional(StatusSchema),
  priority: Type.Optional(PrioritySchema),
  description: Type.Optional(Markdown),
  implementationLog: Type.Optional(Markdown),
  estimatedHours: Type.Optional(NullableInput(Hours)),
  estimatedDays: Type.Optional(NullableInput(Days)),
  progress: Type.Optional(Progress),
  position: Type.Optional(Position),
  startDate: Type.Optional(NullableInput(DateOnly)),
  dueDate: Type.Optional(NullableInput(DateOnly)),
}

export const WorkItemCreateSchema = StrictObject(
  { type: WorkItemTypeSchema, title: Title, ...workItemInput },
  { description: 'Estimation en estimatedHours OU estimatedDays (converti avec le hoursPerDay du projet)' },
)
export type WorkItemCreate = Static<typeof WorkItemCreateSchema>

export const WorkItemUpdateSchema = StrictObject(
  {
    type: Type.Optional(WorkItemTypeSchema),
    title: Type.Optional(Title),
    storyId: Type.Optional(Type.Integer({ minimum: 1, description: 'Déplace l’élément vers une autre story du même projet' })),
    ...workItemInput,
  },
  { description: 'Passer à RESOLVED ou CLOSED fixe l’avancement à 100 % sauf si progress est fourni' },
)
export type WorkItemUpdate = Static<typeof WorkItemUpdateSchema>

export const WorkItemListQuery = Type.Object({
  type: Type.Optional(Type.Array(WorkItemTypeSchema)),
  status: Type.Optional(Type.Array(StatusSchema)),
  phaseId: Type.Optional(Id),
  epicId: Type.Optional(Id),
  storyId: Type.Optional(Id),
  q: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: 'Recherche dans le titre, ou #ID' })),
})
export type WorkItemFilters = Static<typeof WorkItemListQuery>

export const LogEntryCreateSchema = StrictObject(
  {
    text: Type.String({ minLength: 1, maxLength: 20_000, description: 'Texte Markdown de l’entrée' }),
    at: Type.Optional(DateTime),
    hours: Type.Optional(NullableInput(Type.Number({ minimum: 0, maximum: 24, description: 'Temps mentionné dans l’en-tête' }))),
  },
  { description: 'Ajoute une entrée horodatée « > **18 Oct 2026 - 16h30 (4.5h passées) :** … » au journal' },
)
export type LogEntryCreate = Static<typeof LogEntryCreateSchema>

export const WorkItemParams = Type.Object({ workItemId: Id })
