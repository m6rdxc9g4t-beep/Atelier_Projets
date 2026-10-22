// Idempotence HTTP (docs/SUITE.md §4.1 et §7.4) : en-tête Idempotency-Key (1 à 200 caractères) sur les écritures
// qui créent quelque chose. Même clé + même contenu → même réponse (statut et corps) avec Idempotency-Replayed: true ;
// même clé + autre contenu → 409 IDEMPOTENCY_KEY_REUSED. La logique (table IdempotencyRecord, transaction, 30 jours)
// est dans services/idempotency.ts ; ce module ne fait que relier la requête Fastify et la réponse.
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Type } from 'typebox'
import type { Db } from '../db/client.ts'
import { hashRequest, normalizeIdempotencyKey, runIdempotent } from '../services/idempotency.ts'

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key'
export const IDEMPOTENCY_REPLAYED_HEADER = 'idempotency-replayed'

/** En-tête accepté par les routes idempotentes (schéma des headers Fastify). */
export const IdempotencyKeySchema = Type.String({
  minLength: 1,
  maxLength: 200,
  description: 'Une même clé rejouée avec le même contenu renvoie la même réponse sans refaire l’écriture (30 jours)',
})
export const IdempotencyHeaders = Type.Object({ [IDEMPOTENCY_KEY_HEADER]: Type.Optional(IdempotencyKeySchema) })

/** Valeur d'un en-tête (la première si répété). */
export function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

export interface IdempotentRoute {
  /** Portée de la clé (identifiant de l'action). */
  scope: string
  /** Statut de la réponse en cas de succès (rejoué tel quel). */
  statusCode: number
  /** Contenu qui identifie la requête ; par défaut paramètres de chemin, requête et corps. */
  hashSource?: unknown
  now: Date
  timeoutMs?: number
}

/**
 * Exécute `write` dans une transaction (avec l'enregistrement de la clé s'il y en a une) et envoie la réponse.
 * `write` reçoit la transaction : services et événements doivent l'utiliser pour rester atomiques avec la clé.
 */
export async function sendIdempotent<T>(
  prisma: Db,
  request: FastifyRequest,
  reply: FastifyReply,
  route: IdempotentRoute,
  write: (db: Db) => Promise<T>,
): Promise<FastifyReply> {
  const key = normalizeIdempotencyKey(headerValue(request, IDEMPOTENCY_KEY_HEADER))
  const source = route.hashSource ?? { params: request.params ?? null, query: request.query ?? null, body: request.body ?? null }
  const outcome = await runIdempotent(
    prisma,
    { scope: route.scope, key, hash: hashRequest(source), statusCode: route.statusCode, now: route.now, ...(route.timeoutMs && { timeoutMs: route.timeoutMs }) },
    write,
  )
  if (outcome.replayed) reply.header(IDEMPOTENCY_REPLAYED_HEADER, 'true')
  return reply.code(outcome.statusCode).send(outcome.body)
}
