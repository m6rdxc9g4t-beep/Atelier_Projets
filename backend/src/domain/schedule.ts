// Planification du Gantt : dépendances « fin → début », marge, cycles, chemin critique, résolution des
// conflits. Module pur (dates calendaires « YYYY-MM-DD », bornes incluses), testable sans base.
import type { DateSpan } from './hierarchy.ts'

const DAY_MS = 86_400_000

export interface Dependency {
  predecessorId: number
  successorId: number
}

function toTime(day: string): number {
  return Date.parse(`${day}T00:00:00Z`)
}

/** Nombre de jours de `from` à `to` (négatif si `to` est avant). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toTime(to) - toTime(from)) / DAY_MS)
}

/** Date décalée de `days` jours. */
export function shiftDay(day: string, days: number): string {
  return new Date(toTime(day) + days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Marge d'une dépendance, en jours : 0 si le successeur commence le lendemain de la fin du prédécesseur,
 * négative s'il commence trop tôt (conflit). null si l'un des deux n'est pas planifié.
 */
export function dependencySlack(predecessor: DateSpan | null, successor: DateSpan | null): number | null {
  if (!predecessor || !successor) return null
  return daysBetween(predecessor.end, successor.start) - 1
}

/** Ajouter « predecessor → successor » créerait-il un cycle (le successeur précède-t-il déjà le prédécesseur) ? */
export function wouldCreateCycle(dependencies: readonly Dependency[], predecessorId: number, successorId: number): boolean {
  if (predecessorId === successorId) return true
  const next = new Map<number, number[]>()
  for (const { predecessorId: from, successorId: to } of dependencies) {
    const list = next.get(from)
    if (list) list.push(to)
    else next.set(from, [to])
  }
  const seen = new Set<number>()
  const stack = [successorId]
  while (stack.length > 0) {
    const current = stack.pop() as number
    if (current === predecessorId) return true
    if (seen.has(current)) continue
    seen.add(current)
    stack.push(...(next.get(current) ?? []))
  }
  return false
}

/**
 * Chemin critique : les éléments planifiés qui finissent le plus tard, puis, en remontant les dépendances,
 * les prédécesseurs sans marge (marge ≤ 0) — tout retard sur eux retarde la fin du projet.
 */
export function criticalPath(spans: ReadonlyMap<number, DateSpan | null>, dependencies: readonly Dependency[]): number[] {
  let latest: string | null = null
  for (const span of spans.values()) if (span && (latest === null || span.end > latest)) latest = span.end
  if (latest === null) return []
  const critical = new Set<number>()
  const queue: number[] = []
  for (const [id, span] of spans) {
    if (span?.end === latest) {
      critical.add(id)
      queue.push(id)
    }
  }
  const predecessorsOf = new Map<number, number[]>()
  for (const { predecessorId, successorId } of dependencies) {
    const list = predecessorsOf.get(successorId)
    if (list) list.push(predecessorId)
    else predecessorsOf.set(successorId, [predecessorId])
  }
  while (queue.length > 0) {
    const successor = queue.shift() as number
    for (const predecessor of predecessorsOf.get(successor) ?? []) {
      if (critical.has(predecessor)) continue
      const slack = dependencySlack(spans.get(predecessor) ?? null, spans.get(successor) ?? null)
      if (slack !== null && slack <= 0) {
        critical.add(predecessor)
        queue.push(predecessor)
      }
    }
  }
  return [...critical].sort((a, b) => a - b)
}

/**
 * Résout les conflits : chaque successeur qui commence trop tôt est décalé (durée conservée) pour commencer
 * le lendemain de la fin de son dernier prédécesseur, en cascade dans l'ordre des dépendances.
 * Renvoie les nouvelles plages des seuls éléments déplacés. Les éléments non planifiés ne bougent pas.
 */
export function resolveConflicts(spans: ReadonlyMap<number, DateSpan | null>, dependencies: readonly Dependency[]): Map<number, DateSpan> {
  const current = new Map(spans)
  const moved = new Map<number, DateSpan>()
  const incoming = new Map<number, number>()
  const next = new Map<number, number[]>()
  for (const { predecessorId, successorId } of dependencies) {
    incoming.set(successorId, (incoming.get(successorId) ?? 0) + 1)
    const list = next.get(predecessorId)
    if (list) list.push(successorId)
    else next.set(predecessorId, [successorId])
  }
  const predecessorsOf = new Map<number, number[]>()
  for (const { predecessorId, successorId } of dependencies) {
    const list = predecessorsOf.get(successorId)
    if (list) list.push(predecessorId)
    else predecessorsOf.set(successorId, [predecessorId])
  }
  // Ordre topologique (Kahn) : un élément n'est traité qu'après tous ses prédécesseurs.
  const ids = new Set([...dependencies.flatMap((dependency) => [dependency.predecessorId, dependency.successorId])])
  const queue = [...ids].filter((id) => !incoming.has(id)).sort((a, b) => a - b)
  while (queue.length > 0) {
    const id = queue.shift() as number
    const span = current.get(id) ?? null
    if (span) {
      let earliest: string | null = null
      for (const predecessor of predecessorsOf.get(id) ?? []) {
        const before = current.get(predecessor)
        if (before && (earliest === null || shiftDay(before.end, 1) > earliest)) earliest = shiftDay(before.end, 1)
      }
      if (earliest !== null && span.start < earliest) {
        const delta = daysBetween(span.start, earliest)
        const shifted = { start: shiftDay(span.start, delta), end: shiftDay(span.end, delta) }
        current.set(id, shifted)
        moved.set(id, shifted)
      }
    }
    for (const successor of next.get(id) ?? []) {
      const remaining = (incoming.get(successor) ?? 1) - 1
      incoming.set(successor, remaining)
      if (remaining === 0) queue.push(successor)
    }
  }
  return moved
}
