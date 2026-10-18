// Référentiel du workflow (CLAUDE.md §2) : types de WorkItem, les 8 statuts dans l'ordre officiel, priorités.
// Module pur : aucune dépendance à Prisma ni à Fastify (la parité avec les enums Prisma est vérifiée
// à la compilation dans src/db/enum-parity.ts).

export const WORK_ITEM_TYPES = ['FEATURE', 'TASK', 'BUG'] as const
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number]

/** Les 8 statuts, dans l'ordre du workflow (et des barres de l'histogramme du dashboard). */
export const WORK_ITEM_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'IN_REVIEW',
  'ON_HOLD',
  'BLOCKED',
  'RESOLVED',
  'CLOSED',
  'REJECTED',
] as const
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number]

export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'IMMEDIATE'] as const
export type Priority = (typeof PRIORITIES)[number]

/** Statuts « terminés » : le travail est fait, il compte pour 100 % dans les agrégats. */
export const DONE_STATUSES: ReadonlySet<WorkItemStatus> = new Set<WorkItemStatus>(['RESOLVED', 'CLOSED'])

export function isDone(status: WorkItemStatus): boolean {
  return DONE_STATUSES.has(status)
}

/** Un élément rejeté sort du périmètre : ni budget ni avancement (son temps passé reste compté). */
export function isRejected(status: WorkItemStatus): boolean {
  return status === 'REJECTED'
}

export type StatusCounts = Record<WorkItemStatus, number>
export type TypeCounts = Record<WorkItemType, number>

export function emptyStatusCounts(): StatusCounts {
  return Object.fromEntries(WORK_ITEM_STATUSES.map((status) => [status, 0])) as StatusCounts
}

export function emptyTypeCounts(): TypeCounts {
  return Object.fromEntries(WORK_ITEM_TYPES.map((type) => [type, 0])) as TypeCounts
}
