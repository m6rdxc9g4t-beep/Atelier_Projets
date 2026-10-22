// Conversion camelCase → snake_case pour le nœud Atelier (docs/SUITE.md §7.1 : propriétés en snake_case).
// Les routes /api/atelier/* délèguent aux services existants (DTO en camelCase) puis convertissent la réponse ;
// le schéma JSON de sortie est converti de la même façon depuis le schéma TypeBox, pour qu'ils ne divergent jamais.
// Une clé entièrement en majuscules (OPEN, IN_PROGRESS, FEATURE : valeurs d'énumération utilisées comme clés) est gardée.

/** « hoursPerDay » → « hours_per_day » ; « IN_PROGRESS » et « snake_case » inchangés. */
export function toSnakeKey(key: string): string {
  if (/^[A-Z0-9_]+$/.test(key)) return key
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

/** Copie profonde d'une valeur JSON dont les clés d'objet sont converties en snake_case. */
export function snakeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeKeys)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [toSnakeKey(key), snakeKeys(item)]))
  }
  return value
}

type JsonSchema = Record<string, unknown>

/** Sous-schémas à parcourir (un seul schéma, liste ou dictionnaire de schémas). */
const ONE = ['items', 'not', 'additionalProperties', 'contains', 'if', 'then', 'else'] as const
const MANY = ['anyOf', 'oneOf', 'allOf', 'prefixItems'] as const
const MAP = ['patternProperties', '$defs', 'definitions'] as const

/**
 * Schéma JSON (TypeBox sérialisé) dont les noms de propriétés (properties, required) sont en snake_case.
 * Le résultat est un objet JSON simple (sans les métadonnées internes de TypeBox).
 */
export function snakeSchema(schema: unknown): JsonSchema {
  const plain = JSON.parse(JSON.stringify(schema)) as JsonSchema
  return convert(plain)
}

function convert(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...schema }
  if (isObject(schema.properties)) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, sub]) => [toSnakeKey(key), convertAny(sub)]))
  }
  if (Array.isArray(schema.required)) out.required = schema.required.map((key) => (typeof key === 'string' ? toSnakeKey(key) : key))
  for (const key of ONE) if (isObject(schema[key])) out[key] = convert(schema[key] as JsonSchema)
  for (const key of MANY) if (Array.isArray(schema[key])) out[key] = (schema[key] as unknown[]).map(convertAny)
  for (const key of MAP) {
    if (isObject(schema[key])) out[key] = Object.fromEntries(Object.entries(schema[key] as JsonSchema).map(([name, sub]) => [name, convertAny(sub)]))
  }
  return out
}

function convertAny(value: unknown): unknown {
  return isObject(value) ? convert(value) : value
}

function isObject(value: unknown): value is JsonSchema {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
