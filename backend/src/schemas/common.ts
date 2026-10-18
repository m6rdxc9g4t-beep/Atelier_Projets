// Schémas TypeBox partagés : ils valident les requêtes, typent les handlers et alimentent l'OpenAPI.
import {
  Type,
  type Static,
  type TInteger,
  type TNumber,
  type TObjectOptions,
  type TProperties,
  type TSchema,
  type TString,
} from 'typebox'
import { MAX_HOURS_PER_DAY } from '../domain/durations.ts'
import { PRIORITIES, WORK_ITEM_STATUSES, WORK_ITEM_TYPES } from '../domain/workflow.ts'

/** Objet strict : un champ inconnu dans un corps de requête est refusé (400). */
export function StrictObject<Properties extends TProperties>(properties: Properties, options?: TObjectOptions) {
  return Type.Object(properties, { additionalProperties: false, ...options })
}

/** Valeur ou null, pour les réponses (anyOf). */
export const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()])

/**
 * Valeur ou null, pour les requêtes : `type: [T, "null"]` plutôt qu'un anyOf, sinon la coercition d'Ajv
 * (active pour les querystrings) transformerait un null envoyé en 0 ou en "" au lieu d'effacer le champ.
 */
export function NullableInput<T extends TNumber | TInteger | TString>(schema: T) {
  const { type, ...constraints } = schema as unknown as { type: string } & Record<string, unknown>
  return Type.Unsafe<Static<T> | null>({ ...constraints, type: [type, 'null'] })
}

export const Id = Type.Integer({ minimum: 1 })
export const DateOnly = Type.String({ format: 'date', description: 'Date calendaire AAAA-MM-JJ', examples: ['2026-10-18'] })
export const DateTime = Type.String({ format: 'date-time', examples: ['2026-10-18T14:30:00.000Z'] })
export const Title = Type.String({ minLength: 1, maxLength: 200 })
export const Markdown = Type.String({ maxLength: 100_000, description: 'Texte Markdown' })
export const Position = Type.Integer({ minimum: 0, description: 'Ordre d’affichage parmi les éléments frères' })
export const HoursPerDay = Type.Number({
  exclusiveMinimum: 0,
  maximum: MAX_HOURS_PER_DAY,
  description: 'Conversion : 1 jour = hoursPerDay heures',
})
export const Hours = Type.Number({ minimum: 0, description: 'Durée en heures' })
export const Days = Type.Number({ minimum: 0, description: 'Durée en jours (convertie avec hoursPerDay)' })

export const WorkItemTypeSchema = Type.Enum(WORK_ITEM_TYPES, { type: 'string', description: 'FEATURE | TASK | BUG' })
export const StatusSchema = Type.Enum(WORK_ITEM_STATUSES, { type: 'string', description: 'Un des 8 statuts du workflow' })
export const PrioritySchema = Type.Enum(PRIORITIES, { type: 'string' })

export const DurationSchema = Type.Object(
  { hours: Type.Number(), days: Type.Number() },
  { description: 'Durée exprimée en heures et en jours (1 jour = hoursPerDay heures)' },
)

export const DateSpanSchema = Type.Object(
  { start: DateOnly, end: DateOnly },
  { description: 'Plage de dates (bornes incluses)' },
)

export const StatusCountsSchema = Type.Object({
  OPEN: Type.Integer(),
  IN_PROGRESS: Type.Integer(),
  IN_REVIEW: Type.Integer(),
  ON_HOLD: Type.Integer(),
  BLOCKED: Type.Integer(),
  RESOLVED: Type.Integer(),
  CLOSED: Type.Integer(),
  REJECTED: Type.Integer(),
})

export const TypeCountsSchema = Type.Object({ FEATURE: Type.Integer(), TASK: Type.Integer(), BUG: Type.Integer() })

export const BalanceSchema = Type.Object(
  {
    kind: Type.Enum(['UNDER', 'ON_BUDGET', 'OVER', 'REMAINING'], { type: 'string' }),
    delta: DurationSchema,
  },
  {
    description:
      'Bilan : UNDER / ON_BUDGET / OVER = réalisé − estimé d’un élément terminé (ou dépassement en cours) ; REMAINING = reste à consommer',
  },
)

/** Référence affichable d'un conteneur de la hiérarchie (« EPIC 2 : Design System »). */
export const ContainerRefSchema = Type.Object({ id: Id, code: Type.String(), title: Type.String() })

export const ErrorSchema = Type.Object(
  { statusCode: Type.Integer(), error: Type.String(), code: Type.String(), message: Type.String() },
  { description: 'Erreur' },
)

/** Réponses d'erreur à documenter pour une route. */
export function errorResponses<Code extends 400 | 404 | 409>(...statusCodes: Code[]): Record<Code, typeof ErrorSchema> {
  return Object.fromEntries(statusCodes.map((statusCode) => [statusCode, ErrorSchema])) as Record<Code, typeof ErrorSchema>
}

export const NoContent = Type.Null({ description: 'Aucun contenu' })
