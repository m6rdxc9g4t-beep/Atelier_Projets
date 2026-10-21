// Journal d'événements du nœud Atelier (docs/SUITE.md §7.3) : les services l'alimentent dans la transaction de
// leur écriture (pas les routes), Atelier Nexus le lit par GET /api/atelier/events.
// - seq : AUTOINCREMENT de SQLite, strictement croissant et jamais réutilisé, même après une purge ou un redémarrage ;
// - rétention : un événement n'est retiré que s'il a plus de 30 jours ET n'est pas parmi les 1 000 derniers ;
// - data : identifiants, libellés, statuts et nombres agrégés seulement (jamais de ligne de données ni de secret).
import type { Db } from '../db/client.ts'
import { formatDateOnly } from '../domain/dates.ts'
import type { AtelierEventDto, AtelierEventPageDto, EventDataMap, ProjetsEventType } from '../schemas/atelier.ts'

/** Nombre d'événements toujours conservés, quel que soit leur âge. */
export const EVENT_KEEP_COUNT = 1000
/** Âge en deçà duquel un événement est toujours conservé. */
export const EVENT_KEEP_MS = 30 * 24 * 3600 * 1000

export type SubjectKind = 'work_item' | 'milestone' | 'project'

export interface NodeEvent<T extends ProjetsEventType = ProjetsEventType> {
  type: T
  subject: { kind: SubjectKind; id: number | string; label: string }
  data: EventDataMap[T]
}

/** Construit un événement typé (le type fixe la forme de data). */
export function nodeEvent<T extends ProjetsEventType>(type: T, subject: NodeEvent<T>['subject'], data: EventDataMap[T]): NodeEvent<T> {
  return { type, subject, data }
}

/** Identifiant d'une ressource dans data et subject.id (chaînes, comme l'exemple du contrat §7.3). */
export const ref = (id: number): string => String(id)

/** Événement « temps saisi » (saisie directe ou arrêt du chronomètre) ; sujet : l'élément. */
export function timeEntryEvent(item: { id: number; projectId: number; title: string }, entry: { id: number; hours: number; spentOn: Date }): NodeEvent {
  return nodeEvent(
    'projets.time_entry.created',
    { kind: 'work_item', id: ref(item.id), label: item.title },
    { project_id: ref(item.projectId), time_entry_id: ref(entry.id), hours: entry.hours, spent_on: formatDateOnly(entry.spentOn) },
  )
}

/** Enregistre des événements (dans l'ordre donné) puis purge les plus anciens au-delà de la rétention. */
export async function emitEvents(db: Db, events: readonly NodeEvent[], at: Date): Promise<void> {
  if (events.length === 0) return
  for (const event of events) {
    await db.atelierEvent.create({
      data: {
        type: event.type,
        at,
        subjectKind: event.subject.kind,
        subjectId: String(event.subject.id),
        subjectLabel: event.subject.label,
        data: JSON.stringify(event.data),
      },
    })
  }
  await purgeEvents(db, at)
}

/** Retire les événements à la fois plus vieux que 30 jours et hors des 1 000 derniers. */
export async function purgeEvents(db: Db, now: Date): Promise<number> {
  const latest = await db.atelierEvent.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true } })
  if (!latest || latest.seq <= EVENT_KEEP_COUNT) return 0
  const { count } = await db.atelierEvent.deleteMany({
    where: { seq: { lte: latest.seq - EVENT_KEEP_COUNT }, at: { lt: new Date(now.getTime() - EVENT_KEEP_MS) } },
  })
  return count
}

export interface EventQuery {
  since?: number
  limit?: number
  types?: string
}

export const DEFAULT_EVENT_LIMIT = 100
export const MAX_EVENT_LIMIT = 500

function toDto(row: { seq: number; type: string; at: Date; subjectKind: string; subjectId: string; subjectLabel: string; data: string }): AtelierEventDto {
  return {
    seq: row.seq,
    type: row.type,
    at: row.at.toISOString(),
    subject: { kind: row.subjectKind, id: row.subjectId, label: row.subjectLabel },
    data: JSON.parse(row.data) as Record<string, unknown>,
  }
}

/**
 * Page d'événements : après `since` (exclusif) dans l'ordre croissant, ou les plus récents sans `since`.
 * next = dernier seq rendu (ou since, ou le dernier seq connu s'il n'y a rien) ; oldest = plus petit seq conservé (dernier seq + 1 si le journal est vide) ;
 * gap = des événements postérieurs à since ont été purgés (since < oldest − 1), ou la base a été remplacée (since > dernier seq).
 */
export async function listEvents(db: Db, query: EventQuery): Promise<AtelierEventPageDto> {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_EVENT_LIMIT, 1), MAX_EVENT_LIMIT)
  const types = (query.types ?? '')
    .split(',')
    .map((type) => type.trim())
    .filter((type) => type !== '')
  const typeFilter = types.length > 0 ? { type: { in: types } } : {}
  const [first, last] = await Promise.all([
    db.atelierEvent.findFirst({ orderBy: { seq: 'asc' }, select: { seq: true } }),
    db.atelierEvent.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true } }),
  ])
  const latest = last?.seq ?? 0
  // §7.7 : journal vide → oldest = dernier seq connu + 1.
  const oldest = first?.seq ?? latest + 1
  const since = query.since

  const rows =
    since === undefined
      ? (await db.atelierEvent.findMany({ where: typeFilter, orderBy: { seq: 'desc' }, take: limit })).reverse()
      : await db.atelierEvent.findMany({ where: { ...typeFilter, seq: { gt: since } }, orderBy: { seq: 'asc' }, take: limit })

  const events = rows.map(toDto)
  const next = events.at(-1)?.seq ?? since ?? latest
  const gap = since !== undefined && (since < oldest - 1 || since > latest)
  return { events, next, oldest, gap }
}
