// Export CSV pour Excel / Numbers en français : séparateur « ; », virgule décimale, UTF-8 avec BOM.

/** Cellule CSV : entre guillemets si nécessaire, guillemets doublés. Les formules (=, +, -, @) sont neutralisées. */
export function csvCell(value: string | number | null): string {
  if (value === null) return ''
  if (typeof value === 'number') return String(value).replace('.', ',')
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[;"\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null>>): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(';'))
  return `﻿${lines.join('\r\n')}\r\n`
}
