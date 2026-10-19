// Import DataFlow v2.1.0 depuis Atelier Tab (docs/SUITE.md §4.1) : enveloppe reçue, paramètres et réponses.
// L'enveloppe reproduit le schéma Zod d'Atelier Tab (src/dataflow/schema/atelier.v2_1.ts) sans dépendre de
// ce dépôt. Les objets ne sont pas stricts : Atelier Tab peut ajouter des clés facultatives (extensions
// ignorables). La version du schéma est contrôlée par le service (422 si elle diffère de 2.1.0).
import { Type, type Static } from 'typebox'
import { ATELIER_COLUMN_TYPES, ATELIER_MAPPINGS } from '../domain/atelier-tab.ts'
import { Id, Nullable, StatusSchema, WorkItemTypeSchema } from './common.ts'

/** Lignes acceptées au plus par import (au-delà : 400). */
export const MAX_IMPORT_RECORDS = 10_000

const ColLetter = Type.String({ pattern: '^[A-Z]{1,3}$', description: 'Lettre de colonne (A, B… AA)' })

const CellSchema = Type.Object(
  {
    raw: Type.String({ description: 'Saisie d’origine en texte, formule incluse (« =C1*1.2 ») ; vide : ""' }),
    computed: Type.Union([Type.Number(), Type.String(), Type.Boolean(), Type.Null()], {
      description: 'Valeur évaluée, ou code d’erreur de formule (« #DIV/0! »)',
    }),
  },
  { description: 'Cellule exportée sous double forme' },
)

const RecordSchema = Type.Object({
  row_index: Type.Integer({ minimum: 1, description: 'Numéro de ligne affiché dans Atelier Tab (1 = première ligne)' }),
  record_id: Type.String({ minLength: 1, maxLength: 200 }),
  values: Type.Record(ColLetter, CellSchema),
})

const ColumnSchema = Type.Object({
  col_letter: ColLetter,
  id: Type.String({ minLength: 1 }),
  label: Type.String(),
  type: Type.Enum(ATELIER_COLUMN_TYPES, { type: 'string' }),
  atelier_mapping: Type.Enum(ATELIER_MAPPINGS, { type: 'string', description: 'Rôle de la colonne côté Atelier Projets' }),
})

const Named = Type.Object({ id: Type.String({ minLength: 1 }), name: Type.String() })

export const DataflowEnvelopeSchema = Type.Object(
  {
    target_system: Type.Literal('atelier_projets'),
    schema_version: Type.String({ description: 'Version du schéma : 2.1.0 (une autre version est refusée en 422)', examples: ['2.1.0'] }),
    exported_at: Type.String({ description: 'Horodatage ISO 8601 de l’export' }),
    workspace: Named,
    project: Type.Object({
      id: Type.String({ minLength: 1 }),
      name: Type.String(),
      source_table: Type.Optional(Named),
      summary_metrics: Type.Optional(
        Type.Object({
          total_rows: Type.Integer({ minimum: 0 }),
          computed_totals: Type.Record(ColLetter, Type.Number()),
        }),
      ),
      columns_schema: Type.Array(ColumnSchema, { minItems: 1 }),
      records: Type.Array(RecordSchema, { maxItems: MAX_IMPORT_RECORDS }),
      summary_rows: Type.Optional(Type.Array(RecordSchema)),
    }),
  },
  { description: 'Enveloppe DataFlow v2.1.0 produite par Atelier Tab (docs/DATAFLOW_SPEC.md d’Atelier Tab)' },
)
export type DataflowEnvelopeInput = Static<typeof DataflowEnvelopeSchema>

export const ImportQuery = Type.Object({
  projectId: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 2_147_483_647, description: 'Projet cible ; sinon le projet nommé comme project.name (créé au besoin)' }),
  ),
  type: Type.Optional(Type.Enum(['FEATURE', 'TASK', 'BUG'], { type: 'string', description: 'Type des éléments créés : TASK par défaut' })),
})
export type ImportOptions = Static<typeof ImportQuery>

export const ImportHeaders = Type.Object({
  'idempotency-key': Type.Optional(
    Type.String({ minLength: 1, maxLength: 200, description: 'Une même clé rejouée renvoie la même réponse sans réimporter' }),
  ),
  'x-atelier-schema-version': Type.Optional(Type.String({ description: 'Si présent : 2.1.0, sinon 422' })),
  authorization: Type.Optional(Type.String({ description: 'Bearer <jeton> : exigé si ATELIER_IMPORT_TOKEN est configuré' })),
})

const ImportAction = Type.Enum(['created', 'updated', 'unchanged', 'skipped'], {
  type: 'string',
  description: 'created / updated / unchanged (réimport sans changement) / skipped (ligne ignorée) — prévu (aperçu) ou fait (import)',
})

export const ImportItemSchema = Type.Object({
  recordId: Type.String(),
  rowIndex: Type.Integer(),
  workItemId: Nullable(Id),
  action: ImportAction,
  title: Nullable(Type.String()),
  status: Nullable(StatusSchema),
  startDate: Nullable(Type.String()),
  dueDate: Nullable(Type.String()),
  /** Raison d'une ligne ignorée. */
  reason: Nullable(Type.String()),
})

const ImportCounts = {
  projectId: Nullable(Id),
  storyId: Nullable(Id),
  created: Type.Integer(),
  updated: Type.Integer(),
  unchanged: Type.Integer(),
  skipped: Type.Integer(),
  warnings: Type.Array(Type.String()),
  items: Type.Array(ImportItemSchema),
}

export const ImportResultSchema = Type.Object(ImportCounts, {
  description: 'Résultat de l’import : identifiants du projet et de la story, compteurs, avertissements, lignes',
})
export type ImportResultDto = Static<typeof ImportResultSchema>

export const ImportPreviewSchema = Type.Object(
  {
    ...ImportCounts,
    target: Type.Object({
      project: Type.Object({ id: Nullable(Id), name: Type.String(), exists: Type.Boolean() }),
      phase: Type.Object({ title: Type.String(), exists: Type.Boolean() }),
      epic: Type.Object({ title: Type.String(), exists: Type.Boolean() }),
      story: Type.Object({ title: Type.String(), exists: Type.Boolean() }),
      type: WorkItemTypeSchema,
    }),
  },
  { description: 'Aperçu : ce que l’import ferait (rien n’est modifié)' },
)
export type ImportPreviewDto = Static<typeof ImportPreviewSchema>
