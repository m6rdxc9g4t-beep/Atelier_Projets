// Idempotence des écritures (docs/SUITE.md §4.1 et §7.4) : la réponse d'une écriture faite avec un en-tête
// Idempotency-Key est enregistrée dans la table IdempotencyRecord, dans la même transaction que l'écriture.
// Une même clé rejouée (même portée, même contenu) renvoie la même réponse sans refaire l'écriture ;
// réutilisée pour un autre contenu : 409 IDEMPOTENCY_KEY_REUSED. Réponses conservées 30 jours.
//
// Une table SQLite plutôt qu'un cache en mémoire : la clé survit à un redémarrage de l'API (nouvelle tentative
// d'un webhook ou d'un workflow après une coupure), et l'enregistrement est atomique avec l'écriture (pas de
// fenêtre où l'écriture est faite mais la clé perdue). Les événements du nœud (services/atelier-events.ts) sont
// émis dans cette même transaction : une écriture rejouée n'émet rien.
import { createHash } from 'node:crypto'
import type { Db } from '../db/client.ts'
import { HttpError } from '../http/errors.ts'

/** Réponses conservées (rejeu d'une clé Idempotency-Key) : 30 jours. */
export const IDEMPOTENCY_RETENTION_MS = 30 * 24 * 3600 * 1000
/** Délai par défaut d'une transaction d'écriture idempotente (Prisma : 5 s). */
const DEFAULT_TIMEOUT_MS = 5_000

/** Empreinte SHA-256 (hex) d'un contenu de requête sérialisé en JSON. */
export function hashRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Clé d'un en-tête Idempotency-Key : espaces retirés, absente si vide. */
export function normalizeIdempotencyKey(value: string | undefined): string | null {
  const key = value?.trim() ?? ''
  return key === '' ? null : key
}

export interface IdempotentOptions {
  /** Action concernée (« work_items.create », « imports.atelier_tab »…) : une clé est propre à une action. */
  scope: string
  /** Valeur de l'en-tête Idempotency-Key (null : écriture ordinaire, rien n'est enregistré). */
  key: string | null
  /** Empreinte du contenu de la requête (hashRequest). */
  hash: string
  /** Statut HTTP de la réponse, rejoué tel quel. */
  statusCode: number
  now: Date
  /** Délai de la transaction (un gros import dépasse les 5 s par défaut). */
  timeoutMs?: number
}

export interface IdempotentOutcome<T> {
  statusCode: number
  body: T
  /** Réponse rejouée depuis une clé déjà traitée. */
  replayed: boolean
}

async function storedResponse<T>(db: Db, scope: string, key: string, hash: string): Promise<IdempotentOutcome<T> | null> {
  const stored = await db.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } })
  if (!stored) return null
  if (stored.requestHash !== hash) {
    throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'Cette clé Idempotency-Key a déjà servi pour un autre contenu : utiliser une nouvelle clé')
  }
  return { statusCode: stored.statusCode, body: JSON.parse(stored.response) as T, replayed: true }
}

/**
 * Exécute une écriture dans une transaction ; avec une clé, enregistre sa réponse dans la même transaction,
 * ou renvoie la réponse déjà enregistrée. `write` reçoit la transaction : tout ce qu'il lit et écrit doit passer par elle.
 */
export async function runIdempotent<T>(prisma: Db, options: IdempotentOptions, write: (db: Db) => Promise<T>): Promise<IdempotentOutcome<T>> {
  const { scope, key, hash, statusCode, now } = options
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (key) {
    const replay = await storedResponse<T>(prisma, scope, key, hash)
    if (replay) return replay
  }
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Deux envois simultanés de la même clé : le second voit la réponse du premier.
        if (key) {
          const replay = await storedResponse<T>(tx, scope, key, hash)
          if (replay) return replay
        }
        const body = await write(tx)
        if (key) {
          await tx.idempotencyRecord.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS) } } })
          await tx.idempotencyRecord.create({ data: { scope, key, requestHash: hash, statusCode, response: JSON.stringify(body), createdAt: now } })
        }
        return { statusCode, body, replayed: false }
      },
      { timeout, maxWait: timeout },
    )
  } catch (error) {
    // Course perdue sur la clé (P2002) : l'autre requête a écrit ; renvoyer sa réponse.
    if (key && (error as { code?: string }).code === 'P2002') {
      const replay = await storedResponse<T>(prisma, scope, key, hash)
      if (replay) return replay
    }
    throw error
  }
}
