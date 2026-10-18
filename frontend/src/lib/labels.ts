// Libellés d'affichage (français) des valeurs du workflow. Les couleurs ne sont pas ici :
// elles viennent du design system via data-type / data-status / data-priority / data-balance.
import type { Priority, Trend, WorkItemStatus, WorkItemType } from '../services/types.ts'

/** Les 8 statuts dans l'ordre du workflow (CLAUDE.md §2). */
export const STATUSES: readonly WorkItemStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'IN_REVIEW',
  'ON_HOLD',
  'BLOCKED',
  'RESOLVED',
  'CLOSED',
  'REJECTED',
]

export const STATUS_LABEL: Record<WorkItemStatus, string> = {
  OPEN: 'À faire',
  IN_PROGRESS: 'En cours',
  IN_REVIEW: 'En revue',
  ON_HOLD: 'En attente',
  BLOCKED: 'Bloquée',
  RESOLVED: 'Résolue',
  CLOSED: 'Terminée',
  REJECTED: 'Rejetée',
}

export const STATUS_CODE: Record<WorkItemStatus, string> = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN PROGRESS',
  IN_REVIEW: 'IN REVIEW',
  ON_HOLD: 'ON HOLD',
  BLOCKED: 'BLOCKED',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
  REJECTED: 'REJECTED',
}

export const WORK_ITEM_TYPES: readonly WorkItemType[] = ['FEATURE', 'TASK', 'BUG']

export const TYPE_LABEL: Record<WorkItemType, string> = {
  FEATURE: 'Feature',
  TASK: 'Task',
  BUG: 'Bug',
}

export const TYPE_NAME: Record<WorkItemType, string> = {
  FEATURE: 'Fonctionnalité',
  TASK: 'Tâche',
  BUG: 'Anomalie',
}

export const PRIORITIES: readonly Priority[] = ['LOW', 'NORMAL', 'HIGH', 'IMMEDIATE']

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: 'Basse',
  NORMAL: 'Normale',
  HIGH: 'Haute',
  IMMEDIATE: 'Immédiate',
}

export const TREND_LABEL: Record<Trend, string> = {
  AHEAD: 'En avance ✨',
  ON_TRACK: 'Dans les temps',
  BEHIND: 'En retard',
}

/** Statut affiché par chaque tendance (couleur du badge). */
export const TREND_STATUS: Record<Trend, WorkItemStatus> = {
  AHEAD: 'CLOSED',
  ON_TRACK: 'IN_PROGRESS',
  BEHIND: 'BLOCKED',
}

/** « PHASE 1 », « EPIC 2 », « STORY 2.1 » : numérotation renvoyée par le backend, préfixée du niveau. */
export function levelCode(level: 'PHASE' | 'EPIC' | 'STORY', code: string): string {
  return `${level} ${code}`
}
