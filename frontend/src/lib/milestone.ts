// État affiché d'un jalon : atteint, à venir, ou en retard (date passée sans avoir été atteint).
import type { WorkItemStatus } from '../services/types.ts'

export type MilestoneState = 'reached' | 'late' | 'upcoming'

/** today : jour courant « AAAA-MM-JJ ». Un jalon daté d'aujourd'hui n'est pas encore en retard. */
export function milestoneState(milestone: { date: string; reached: boolean }, today: string): MilestoneState {
  if (milestone.reached) return 'reached'
  return milestone.date.slice(0, 10) < today ? 'late' : 'upcoming'
}

export const MILESTONE_STATE_LABEL: Record<MilestoneState, string> = {
  reached: 'Atteint',
  late: 'En retard',
  upcoming: 'À venir',
}

/** Statut qui donne sa couleur à l'état (le retard reprend celle de la tendance « En retard »). */
export const MILESTONE_STATE_STATUS: Record<MilestoneState, WorkItemStatus> = {
  reached: 'CLOSED',
  late: 'BLOCKED',
  upcoming: 'OPEN',
}
