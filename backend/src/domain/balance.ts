// Bilans budgétaires : colonne « BILAN » du tableau des temps (README §4.D) et tendance du dashboard (§4.A).
import { roundTo } from './durations.ts'
import { isDone, isRejected, type WorkItemStatus } from './workflow.ts'

export type BalanceKind = 'UNDER' | 'ON_BUDGET' | 'OVER' | 'REMAINING'

export interface BalanceResult {
  kind: BalanceKind
  /** UNDER / ON_BUDGET / OVER : réalisé − estimé (signé). REMAINING : estimé − réalisé (≥ 0). */
  deltaHours: number
}

/**
 * Bilan d'un élément :
 * - terminé (RESOLVED / CLOSED) : écart réalisé − estimé → UNDER (< 0), ON_BUDGET (= 0) ou OVER (> 0) ;
 * - non terminé : OVER si le réalisé dépasse déjà l'estimation, sinon REMAINING (estimé − réalisé) ;
 * - rejeté ou non estimé : pas de bilan (null).
 */
export function computeBalance(item: {
  status: WorkItemStatus
  estimatedHours: number | null
  spentHours: number
}): BalanceResult | null {
  if (item.estimatedHours === null || isRejected(item.status)) return null
  const overrun = roundTo(item.spentHours - item.estimatedHours, 2)
  if (isDone(item.status)) {
    return { kind: overrun < 0 ? 'UNDER' : overrun === 0 ? 'ON_BUDGET' : 'OVER', deltaHours: overrun }
  }
  return overrun > 0 ? { kind: 'OVER', deltaHours: overrun } : { kind: 'REMAINING', deltaHours: -overrun }
}

/**
 * Solde d'une enveloppe (budget initial du projet, total du tableau des temps) :
 * REMAINING (reste à consommer, ≥ 0) ou OVER (dépassement, > 0).
 */
export function computeEnvelopeBalance(budgetHours: number, spentHours: number): BalanceResult {
  const overrun = roundTo(spentHours - budgetHours, 2)
  return overrun > 0 ? { kind: 'OVER', deltaHours: overrun } : { kind: 'REMAINING', deltaHours: overrun === 0 ? 0 : -overrun }
}

export type Trend = 'AHEAD' | 'ON_TRACK' | 'BEHIND'

/**
 * Tendance du projet : l'avancement réel comparé à la part du budget consommée, en points de
 * pourcentage arrondis tels qu'ils sont affichés (71 % vs 63 % → AHEAD, « En avance ✨ »).
 */
export function computeTrend(progressPercent: number, consumedPercent: number): Trend {
  const progress = Math.round(progressPercent)
  const consumed = Math.round(consumedPercent)
  if (progress > consumed) return 'AHEAD'
  if (progress < consumed) return 'BEHIND'
  return 'ON_TRACK'
}
