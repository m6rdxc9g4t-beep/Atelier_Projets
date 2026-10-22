// Nœud Atelier (docs/SUITE.md §7, contrat atelier-node/1) : entrées des actions en snake_case, table d'échange
// atelier-table/1, événements et erreurs { detail, code }. Les sorties JSON des actions sont les DTO de l'API
// convertis en snake_case (domain/snake-case.ts), leur schéma dérivé du schéma TypeBox d'origine.
import { Type, type Static, type TSchema } from 'typebox'
import { snakeSchema } from '../domain/snake-case.ts'
import {
  DateOnly,
  DateTime,
  Hours,
  Id,
  Markdown,
  NullableInput,
  PrioritySchema,
  StatusSchema,
  StrictObject,
  Title,
  WorkItemTypeSchema,
} from './common.ts'
import { DATASET_COLUMN_TYPES, DATASET_NAMES } from './exports.ts'
import { MilestoneSchema } from './milestones.ts'
import { ProjectSchema } from './projects.ts'
import { ProjectTreeSchema } from './reports.ts'
import { TimeEntrySchema } from './time-entries.ts'
import { WorkItemDetailSchema } from './work-items.ts'

export const NODE_CONTRACT = 'atelier-node/1'
export const ATELIER_TABLE_FORMAT = 'atelier-table/1'

/** Schéma JSON tel quel, typé comme un objet (sorties converties en snake_case). */
const SnakeOutput = (schema: TSchema, description?: string) =>
  Type.Unsafe<Record<string, unknown>>({ ...snakeSchema(schema), ...(description && { description }) })

// --- Erreurs (§7.5) -------------------------------------------------------------------------------------

export const AtelierErrorSchema = Type.Object(
  {
    detail: Type.String({ description: 'Message en français' }),
    code: Type.String({ description: 'NOT_FOUND, VALIDATION, CONFLICT, IDEMPOTENCY_KEY_REUSED, FORBIDDEN_HOST, FORBIDDEN_ORIGIN…' }),
  },
  { description: 'Erreur d’une action du nœud Atelier' },
)

export function atelierErrors<Code extends 400 | 403 | 404 | 409>(...codes: Code[]): Record<Code, typeof AtelierErrorSchema> {
  return Object.fromEntries(codes.map((code) => [code, AtelierErrorSchema])) as Record<Code, typeof AtelierErrorSchema>
}

// --- Table d'échange atelier-table/1 (§7.2) -------------------------------------------------------------

const CellValue = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])

export const AtelierTableSchema = Type.Object(
  {
    format: Type.Literal(ATELIER_TABLE_FORMAT),
    name: Type.String(),
    label: Type.String(),
    columns: Type.Array(
      Type.Object({
        key: Type.String({ description: 'snake_case sans accent, unique dans la table' }),
        label: Type.String({ description: 'Libellé français' }),
        type: Type.Enum(DATASET_COLUMN_TYPES, { type: 'string' }),
      }),
    ),
    rows: Type.Array(Type.Record(Type.String(), CellValue)),
    total: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], { description: 'Nombre complet de lignes' }),
    truncated: Type.Boolean({ description: 'true quand rows ne contient pas toutes les lignes' }),
  },
  { description: 'Table d’échange atelier-table/1 : date → AAAA-MM-JJ, datetime → ISO 8601, valeur absente → null' },
)
export type AtelierTableDto = Static<typeof AtelierTableSchema>

// --- Paramètres --------------------------------------------------------------------------------------

export const ProjectIdParams = Type.Object({ project_id: Id })
export const StoryIdParams = Type.Object({ story_id: Id })
export const WorkItemIdParams = Type.Object({ work_item_id: Id })
export const MilestoneIdParams = Type.Object({ milestone_id: Id })
export const TableParams = Type.Object({ name: Type.Enum(DATASET_NAMES, { type: 'string', description: 'work-items | time-entries | milestones' }) })
export const TableQuery = Type.Object({ project_id: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_147_483_647, description: 'Un seul projet (tous par défaut)' })) })
export type TableOptions = Static<typeof TableQuery>

// --- Entrées des actions -------------------------------------------------------------------------------

export const WorkItemsQuery = Type.Object({
  status: Type.Optional(Type.Array(StatusSchema, { description: 'Un ou plusieurs statuts' })),
  type: Type.Optional(Type.Array(WorkItemTypeSchema, { description: 'FEATURE, TASK, BUG' })),
  story_id: Type.Optional(Id),
  q: Type.Optional(Type.String({ maxLength: 200, description: 'Recherche dans le titre (sans casse ni accents), ou #ID' })),
  updated_since: Type.Optional(Type.String({ format: 'date-time', description: 'Éléments modifiés depuis cet horodatage (inclus)' })),
})
export type WorkItemsQueryInput = Static<typeof WorkItemsQuery>

export const NodeWorkItemCreateSchema = StrictObject({
  type: WorkItemTypeSchema,
  title: Title,
  status: Type.Optional(StatusSchema),
  priority: Type.Optional(PrioritySchema),
  description: Type.Optional(Markdown),
  estimated_hours: Type.Optional(NullableInput(Hours)),
  due_date: Type.Optional(NullableInput(DateOnly)),
  start_date: Type.Optional(NullableInput(DateOnly)),
})
export type NodeWorkItemCreate = Static<typeof NodeWorkItemCreateSchema>

export const NodeWorkItemUpdateSchema = StrictObject(
  {
    status: Type.Optional(StatusSchema),
    progress: Type.Optional(Type.Integer({ minimum: 0, maximum: 100, description: 'Avancement en %' })),
    priority: Type.Optional(PrioritySchema),
    due_date: Type.Optional(NullableInput(DateOnly)),
    title: Type.Optional(Title),
  },
  { description: 'RESOLVED ou CLOSED fixe l’avancement à 100 %' },
)
export type NodeWorkItemUpdate = Static<typeof NodeWorkItemUpdateSchema>

export const NodeLogEntrySchema = StrictObject({
  text: Type.String({ minLength: 1, maxLength: 20_000, pattern: '\\S', description: 'Texte Markdown de l’entrée' }),
  at: Type.Optional(DateTime),
  hours: Type.Optional(NullableInput(Type.Number({ minimum: 0, maximum: 24, description: 'Temps mentionné dans l’en-tête (informatif)' }))),
})
export type NodeLogEntry = Static<typeof NodeLogEntrySchema>

export const NodeTimeEntrySchema = StrictObject({
  hours: Type.Number({ minimum: 0.01, maximum: 24, description: 'Heures passées (de 0.01 à 24)' }),
  spent_on: Type.Optional(DateOnly),
  comment: Type.Optional(Type.String({ maxLength: 2000 })),
})
export type NodeTimeEntry = Static<typeof NodeTimeEntrySchema>

export const NodeMilestoneReachSchema = StrictObject({
  reached_at: Type.Optional(Type.String({ format: 'date-time', description: 'Date d’atteinte (maintenant par défaut, jamais dans le futur)' })),
})
export type NodeMilestoneReach = Static<typeof NodeMilestoneReachSchema>

/** Corps libre (enveloppe DataFlow v2.1.0 d'Atelier Tab), validé par la route d'import. */
export const DataflowInputSchema = Type.Unsafe<Record<string, unknown>>({
  type: 'object',
  description:
    'Enveloppe DataFlow v2.1.0 d’Atelier Tab (target_system « atelier_projets », schema_version « 2.1.0 », workspace, project.columns_schema, project.records) : docs/SUITE.md §4.1',
})

// --- Sorties --------------------------------------------------------------------------------------------

export const NodeProjectsOutput = Type.Unsafe<Record<string, unknown>[]>({ type: 'array', items: snakeSchema(ProjectSchema), description: 'Projets, par nom' })
export const NodeTreeOutput = SnakeOutput(ProjectTreeSchema, 'Arborescence Phase > Epic > Story > Élément, agrégats, jalons et dépendances')
export const NodeWorkItemOutput = SnakeOutput(WorkItemDetailSchema, 'Fiche complète de l’élément')
export const NodeTimeEntryOutput = SnakeOutput(TimeEntrySchema, 'Saisie de temps créée')
export const NodeMilestoneOutput = SnakeOutput(MilestoneSchema, 'Jalon')
export const NodeLogEntryOutput = Type.Object(
  {
    work_item_id: Id,
    at: DateTime,
    entry: Type.String({ description: 'Entrée ajoutée au journal (Markdown, « > **18 Oct 2026 - 16h30 :** … »)' }),
  },
  { description: 'Entrée ajoutée en fin de journal d’avancement' },
)
export const NodeImportOutput = Type.Unsafe<Record<string, unknown>>({
  type: 'object',
  description: 'Réponse de l’import (camelCase, route existante) : { projectId, storyId, created, updated, unchanged, skipped, warnings, items }',
})

// --- Événements (§7.3) ----------------------------------------------------------------------------------

const RefString = Type.String({ pattern: '^[0-9]+$', description: 'Identifiant (chaîne)' })

export const EVENT_DATA_SCHEMAS = {
  'projets.work_item.created': Type.Object({ project_id: RefString, story_id: RefString, type: WorkItemTypeSchema, status: StatusSchema }),
  'projets.work_item.updated': Type.Object({
    project_id: RefString,
    fields: Type.Array(Type.String(), { description: 'Champs changés (snake_case) : status, progress, due_date, implementation_log…' }),
  }),
  'projets.work_item.status_changed': Type.Object({ project_id: RefString, from: StatusSchema, to: StatusSchema }),
  'projets.work_item.deleted': Type.Object({ project_id: RefString }),
  'projets.time_entry.created': Type.Object({
    project_id: RefString,
    time_entry_id: RefString,
    hours: Type.Number(),
    spent_on: DateOnly,
  }),
  'projets.milestone.reached': Type.Object({
    project_id: RefString,
    date: Type.String({ format: 'date', description: 'Date cible du jalon' }),
    reached_at: DateTime,
  }),
  'projets.import.completed': Type.Object({
    source: Type.Literal('atelier-tab'),
    created: Type.Integer(),
    updated: Type.Integer(),
    unchanged: Type.Integer(),
    skipped: Type.Integer(),
  }),
} as const

export type ProjetsEventType = keyof typeof EVENT_DATA_SCHEMAS
export type EventDataMap = { [K in ProjetsEventType]: Static<(typeof EVENT_DATA_SCHEMAS)[K]> }

export const EVENT_LABELS: Record<ProjetsEventType, string> = {
  'projets.work_item.created': 'Élément créé',
  'projets.work_item.updated': 'Élément modifié',
  'projets.work_item.status_changed': 'Statut d’un élément changé',
  'projets.work_item.deleted': 'Élément supprimé',
  'projets.time_entry.created': 'Temps saisi',
  'projets.milestone.reached': 'Jalon atteint',
  'projets.import.completed': 'Import Atelier Tab terminé',
}

export const EventsQuery = Type.Object({
  since: Type.Optional(Type.Integer({ minimum: 0, description: 'Dernier seq déjà lu (exclusif) ; absent : les plus récents' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: '100 par défaut' })),
  types: Type.Optional(Type.String({ maxLength: 2000, description: 'Types séparés par des virgules' })),
})

export const AtelierEventSchema = Type.Object({
  seq: Type.Integer({ minimum: 1 }),
  type: Type.String(),
  at: DateTime,
  subject: Type.Object({ kind: Type.String(), id: Type.String(), label: Type.String() }),
  data: Type.Record(Type.String(), Type.Unknown()),
})
export type AtelierEventDto = Static<typeof AtelierEventSchema>

export const AtelierEventPageSchema = Type.Object(
  {
    events: Type.Array(AtelierEventSchema),
    next: Type.Integer({ minimum: 0, description: 'Dernier seq rendu (ou since s’il n’y a rien)' }),
    oldest: Type.Integer({ description: 'Plus petit seq encore conservé (dernier seq + 1 si le journal est vide)' }),
    gap: Type.Boolean({ description: 'Des événements ont été perdus depuis since : relire l’état' }),
  },
  { description: 'Événements du nœud (docs/SUITE.md §7.3)' },
)
export type AtelierEventPageDto = Static<typeof AtelierEventPageSchema>

// --- Manifeste (§7.1) -----------------------------------------------------------------------------------

const JsonSchemaObject = Type.Record(Type.String(), Type.Unknown())

export const ManifestSchema = Type.Object(
  {
    contract: Type.Literal(NODE_CONTRACT),
    app: Type.Literal('projets'),
    name: Type.String(),
    version: Type.String(),
    transport: Type.Literal('http'),
    actions: Type.Array(
      Type.Object({
        id: Type.String(),
        label: Type.String(),
        description: Type.String(),
        kind: Type.Enum(['read', 'write', 'destructive'], { type: 'string' }),
        http: Type.Object({ method: Type.Enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], { type: 'string' }), path: Type.String() }),
        mcp_tool: Type.Null(),
        input_schema: JsonSchemaObject,
        output: Type.Object({ format: Type.Enum([ATELIER_TABLE_FORMAT, 'json'], { type: 'string' }), schema: JsonSchemaObject }),
        idempotency: Type.Enum(['header', 'field', 'natural', 'none'], { type: 'string' }),
      }),
    ),
    events: Type.Array(Type.Object({ type: Type.String(), label: Type.String(), data_schema: JsonSchemaObject })),
  },
  { description: 'Manifeste du nœud Atelier Projets (atelier-node/1)' },
)
export type ManifestDto = Static<typeof ManifestSchema>
