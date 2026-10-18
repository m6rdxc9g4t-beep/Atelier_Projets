// Mise en forme des valeurs renvoyées par l'API (aucun calcul métier : jours et heures arrivent calculés).
// Les nombres suivent la maquette du README (« 45.0 j », « 2.50 j (20h) »).
import type { Duration } from '../services/types.ts'

function fixed(value: number, digits: number): string {
  const text = value.toFixed(digits)
  return text === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : text
}

/** « 45.0 j » */
export function days(duration: Duration | null | undefined, digits = 1): string {
  return duration ? `${fixed(duration.days, digits)} j` : '—'
}

/** « 360h », « 4.5h » */
export function hours(value: number): string {
  return `${Number.isInteger(value) ? value : fixed(value, 2).replace(/0$/, '')}h`
}

/** « 2.50 j (20h) » */
export function daysAndHours(duration: Duration | null | undefined, digits = 2): string {
  return duration ? `${fixed(duration.days, digits)} j (${hours(duration.hours)})` : '—'
}

/** Écart signé : « +0.75 j », « -0.50 j », « 0.00 j ». */
export function signedDays(duration: Duration, digits = 2): string {
  const text = fixed(duration.days, digits)
  return `${duration.days > 0 && text !== fixed(0, digits) ? '+' : ''}${text} j`
}

export function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value)}%`
}

/** Pourcentage borné pour une largeur de barre. */
export function clampPercent(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) return 0
  return Math.max(0, Math.min(100, value))
}

const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const fullDayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

/** Date calendaire AAAA-MM-JJ → « 15 oct. » */
export function shortDate(value: string | null | undefined): string {
  return value ? dayFormat.format(parseDate(value)) : '—'
}

/** Date calendaire AAAA-MM-JJ → « 15 oct. 2026 » */
export function longDate(value: string | null | undefined): string {
  return value ? fullDayFormat.format(parseDate(value)) : '—'
}

/** Horodatage ISO → « 18 oct. 2026, 16:30 » (fuseau du navigateur). */
export function dateTime(value: string | null | undefined): string {
  return value ? dateTimeFormat.format(new Date(value)) : '—'
}

const relative = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })

/** Horodatage ISO → « il y a 2 heures », « hier ». */
export function fromNow(value: string, now = Date.now()): string {
  const seconds = (new Date(value).getTime() - now) / 1000
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return 'à l’instant'
}

/** AAAA-MM-JJ → Date à 00:00 UTC. */
export function parseDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`)
}

/** Date → AAAA-MM-JJ (UTC). */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Date du jour (fuseau local) au format AAAA-MM-JJ. */
export function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Saisie utilisateur « 2,5 » ou « 2.5 » → nombre, ou null si vide / invalide. */
export function parseNumber(input: string): number | null {
  const trimmed = input.trim().replace(',', '.')
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/** Dépôt GitHub affichable : « github.com/user/ecom ». */
export function githubLabel(github: { owner: string; repo: string; url?: string } | null | undefined): string | null {
  return github ? `github.com/${github.owner}/${github.repo}` : null
}
