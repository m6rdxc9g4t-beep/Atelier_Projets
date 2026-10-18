// Durées : stockage en heures, conversion en jours avec le paramètre « 1 jour = X heures » (défaut 8 h).

export const DEFAULT_HOURS_PER_DAY = 8
export const MAX_HOURS_PER_DAY = 24

/** Une durée exprimée dans les deux unités affichées par l'interface (« 3.0 j (24h) »). */
export interface Duration {
  hours: number
  days: number
}

/** Arrondi décimal symétrique, sans artefact binaire (1.005 → 1.01, -2.5 → -3) ; -0 devient 0. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  const magnitude = Math.round(Math.abs(value) * (1 + Number.EPSILON) * factor) / factor
  const rounded = value < 0 ? -magnitude : magnitude
  return rounded === 0 ? 0 : rounded
}

export function isValidHoursPerDay(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_HOURS_PER_DAY
}

/** Heures → durée {heures, jours}. Heures à 2 décimales, jours à 4 (l'affichage arrondit ensuite). */
export function toDuration(hours: number, hoursPerDay: number): Duration {
  if (!isValidHoursPerDay(hoursPerDay)) {
    throw new RangeError(`hoursPerDay invalide : ${hoursPerDay} (attendu : 0 < h ≤ ${MAX_HOURS_PER_DAY})`)
  }
  return { hours: roundTo(hours, 2), days: roundTo(hours / hoursPerDay, 4) }
}

export function toDurationOrNull(hours: number | null, hoursPerDay: number): Duration | null {
  return hours === null ? null : toDuration(hours, hoursPerDay)
}

/** Jours saisis → heures stockées. */
export function daysToHours(days: number, hoursPerDay: number): number {
  return roundTo(days * hoursPerDay, 2)
}

/** Somme d'heures, arrondie au centième (évite 0.1 + 0.2 = 0.30000000000000004). */
export function sumHours(values: Iterable<number>): number {
  let total = 0
  for (const value of values) total += value
  return roundTo(total, 2)
}

/** Pourcentage à une décimale ; null si le total est nul (rien à rapporter). */
export function percentOf(part: number, total: number): number | null {
  return total > 0 ? roundTo((part / total) * 100, 1) : null
}
