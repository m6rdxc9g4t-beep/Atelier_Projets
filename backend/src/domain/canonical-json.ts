// Forme canonique d'une valeur JSON : clés d'objet triées à tous les niveaux, tableaux dans leur ordre.
// Deux contenus égaux à l'ordre des clés près ont la même forme, donc la même empreinte (docs/SUITE.md §7.7 :
// « corps canonique, ordre des clés indifférent »). Module pur.

/** JSON canonique de `value` ; comme JSON.stringify, une propriété `undefined` est omise. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sorted(value)) ?? 'null'
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value === null || typeof value !== 'object' || value instanceof Date) return value
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) result[key] = sorted(source[key])
  return result
}
