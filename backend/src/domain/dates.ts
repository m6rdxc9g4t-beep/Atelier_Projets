// Dates calendaires (startDate, dueDate, spentOn, date) : échangées en « YYYY-MM-DD » et stockées à
// 00:00 UTC (cf. schema.prisma), pour qu'un jour reste le même jour quel que soit le fuseau.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/** « 2026-10-18 » → Date à 00:00 UTC. Lève une RangeError si la date n'existe pas (2026-02-30). */
export function parseDateOnly(value: string): Date {
  const match = DATE_ONLY.exec(value)
  if (!match) throw new RangeError(`Date invalide : « ${value} » (format attendu : AAAA-MM-JJ)`)
  const [, year, month, day] = match.map(Number) as [number, number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError(`Date inexistante : « ${value} »`)
  }
  return date
}

export function parseDateOnlyOrNull(value: string | null): Date | null {
  return value === null ? null : parseDateOnly(value)
}

/** Date stockée → « YYYY-MM-DD ». */
export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function formatDateOnlyOrNull(date: Date | null): string | null {
  return date === null ? null : formatDateOnly(date)
}

/** Date du jour dans le fuseau donné (ex. date par défaut d'une saisie de temps). */
export function todayDateOnly(timeZone: string, now: Date = new Date()): string {
  // en-CA formate en AAAA-MM-JJ
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
