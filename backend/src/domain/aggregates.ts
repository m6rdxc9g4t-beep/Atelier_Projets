// Agrégats d'une liste de WorkItems : avancement réel pondéré, statut dérivé d'un conteneur,
// budget estimé et temps réalisé. Utilisé pour les Stories, Epics, Phases et le projet entier.
import { roundTo, sumHours } from './durations.ts'
import { emptyStatusCounts, isDone, isRejected, type StatusCounts, type WorkItemStatus } from './workflow.ts'

export interface AggregatableItem {
  status: WorkItemStatus
  /** Avancement saisi, 0 à 100. */
  progress: number
  estimatedHours: number | null
  spentHours: number
}

/** Avancement retenu dans les agrégats : 100 % si terminé, ignoré (null) si rejeté, sinon la saisie bornée à 0..100. */
export function effectiveProgress(item: Pick<AggregatableItem, 'status' | 'progress'>): number | null {
  if (isRejected(item.status)) return null
  if (isDone(item.status)) return 100
  return Math.min(100, Math.max(0, item.progress))
}

export interface ProgressSummary {
  /** Avancement réel, en % à une décimale. */
  percent: number
  /** Σ des estimations prises en compte (h). */
  plannedHours: number
  /** Σ (estimation × avancement) (h). */
  earnedHours: number
}

/**
 * Avancement réel (README §4) : Σ(estimation × avancement) / Σ(estimations), éléments rejetés exclus.
 * Sans aucune estimation : moyenne simple des avancements. Aucun élément retenu : 0 %.
 */
export function progressSummary(items: readonly AggregatableItem[]): ProgressSummary {
  let planned = 0
  let earned = 0
  let progressTotal = 0
  let counted = 0
  for (const item of items) {
    const progress = effectiveProgress(item)
    if (progress === null) continue
    counted += 1
    progressTotal += progress
    const estimate = item.estimatedHours ?? 0
    if (estimate > 0) {
      planned += estimate
      earned += (estimate * progress) / 100
    }
  }
  const percent = planned > 0 ? (earned / planned) * 100 : counted > 0 ? progressTotal / counted : 0
  return { percent: roundTo(percent, 1), plannedHours: roundTo(planned, 2), earnedHours: roundTo(earned, 2) }
}

/**
 * Statut d'un conteneur (Phase, Epic, Story), dérivé de ses WorkItems :
 * - aucun élément → OPEN ; tous rejetés → REJECTED ;
 * - tous les non-rejetés terminés → CLOSED s'ils sont tous CLOSED, sinon RESOLVED ;
 * - tous les non-rejetés OPEN → OPEN ;
 * - sinon → IN_PROGRESS (le détail reste disponible dans statusCounts).
 */
export function deriveStatus(statuses: readonly WorkItemStatus[]): WorkItemStatus {
  if (statuses.length === 0) return 'OPEN'
  const active = statuses.filter((status) => !isRejected(status))
  if (active.length === 0) return 'REJECTED'
  if (active.every(isDone)) return active.every((status) => status === 'CLOSED') ? 'CLOSED' : 'RESOLVED'
  if (active.every((status) => status === 'OPEN')) return 'OPEN'
  return 'IN_PROGRESS'
}

export function countStatuses(statuses: Iterable<WorkItemStatus>): StatusCounts {
  const counts = emptyStatusCounts()
  for (const status of statuses) counts[status] += 1
  return counts
}

export interface Aggregate {
  status: WorkItemStatus
  progress: number
  /** Budget : Σ des estimations des éléments non rejetés (h). */
  estimateHours: number
  /** Réalisé : Σ du temps saisi sur tous les éléments, rejetés compris (h). */
  spentHours: number
  workItems: number
  statusCounts: StatusCounts
}

export function aggregate(items: readonly AggregatableItem[]): Aggregate {
  const statuses = items.map((item) => item.status)
  return {
    status: deriveStatus(statuses),
    progress: progressSummary(items).percent,
    estimateHours: sumHours(items.filter((item) => !isRejected(item.status)).map((item) => item.estimatedHours ?? 0)),
    spentHours: sumHours(items.map((item) => item.spentHours)),
    workItems: items.length,
    statusCounts: countStatuses(statuses),
  }
}
