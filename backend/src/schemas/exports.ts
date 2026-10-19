// Jeux de données pour Atelier Viz (docs/SUITE.md §4.3) : liste et contenu tabulaire, en lecture seule.
import { Type, type Static } from 'typebox'
import { Nullable } from './common.ts'

export const DATASET_NAMES = ['work-items', 'time-entries', 'milestones'] as const
export type DatasetName = (typeof DATASET_NAMES)[number]

export const DATASET_COLUMN_TYPES = ['string', 'number', 'date', 'datetime', 'boolean'] as const

export const DatasetQuery = Type.Object({
  projectId: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_147_483_647, description: 'Limite le jeu à un projet (tous par défaut)' })),
})
export type DatasetOptions = Static<typeof DatasetQuery>

export const DatasetParams = Type.Object({ name: Type.Enum(DATASET_NAMES, { type: 'string' }) })

export const DatasetInfoSchema = Type.Object({
  name: Type.Enum(DATASET_NAMES, { type: 'string' }),
  label: Type.String(),
  description: Type.String(),
  rowCount: Type.Integer(),
})
export type DatasetInfoDto = Static<typeof DatasetInfoSchema>

export const DatasetColumnSchema = Type.Object({
  key: Type.String({ description: 'Clé en snake_case sans accent, utilisée dans rows' }),
  label: Type.String({ description: 'Libellé français' }),
  type: Type.Enum(DATASET_COLUMN_TYPES, { type: 'string' }),
})
export type DatasetColumn = Static<typeof DatasetColumnSchema>

const CellValue = Nullable(Type.Union([Type.String(), Type.Number(), Type.Boolean()]))

export const DatasetSchema = Type.Object(
  {
    name: Type.Enum(DATASET_NAMES, { type: 'string' }),
    label: Type.String(),
    generatedAt: Type.String({ format: 'date-time' }),
    columns: Type.Array(DatasetColumnSchema),
    rows: Type.Array(Type.Record(Type.String(), CellValue)),
  },
  { description: 'Jeu de données tabulaire : date → AAAA-MM-JJ, datetime → ISO 8601, cellule vide → null' },
)
export type DatasetDto = Static<typeof DatasetSchema>
