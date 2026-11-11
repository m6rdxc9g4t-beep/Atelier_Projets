// Erreurs HTTP de l'API : un format unique { statusCode, error, code, message } pour toutes les réponses
// en erreur (validation, ressources absentes, conflits, erreurs Prisma connues, erreurs internes).
import { STATUS_CODES } from 'node:http'
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma } from '../generated/prisma/client.ts'
import { validationMessage } from './validation-messages.ts'

export class HttpError extends Error {
  readonly statusCode: number
  readonly code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.code = code
  }
}

/** Ressource de l'URL introuvable. */
export const notFound = (message: string): HttpError => new HttpError(404, 'NOT_FOUND', message)
/** Requête incohérente (dates inversées, référence invalide dans le corps…). */
export const badRequest = (message: string): HttpError => new HttpError(400, 'BAD_REQUEST', message)
/** Conflit avec l'état existant (slug déjà pris…). */
export const conflict = (message: string): HttpError => new HttpError(409, 'CONFLICT', message)
/** Action refusée par un réglage (ex. Claude en mode hors ligne). */
export const forbidden = (code: string, message: string): HttpError => new HttpError(403, code, message)
/** Service externe (GitHub) en échec. */
export const badGateway = (code: string, message: string): HttpError => new HttpError(502, code, message)

export interface ErrorBody {
  statusCode: number
  error: string
  code: string
  message: string
}

function errorBody(statusCode: number, code: string, message: string): ErrorBody {
  return { statusCode, error: STATUS_CODES[statusCode] ?? 'Error', code, message }
}

/** Table ou colonne absente : l'API tourne sur une base plus ancienne que le code (migrations en attente). */
export const DATABASE_NOT_MIGRATED_MESSAGE =
  'Base de données non à jour : des migrations sont en attente. Arrêter l’API, lancer « npm run db:deploy --workspace=@atelier/backend » à la racine du dépôt, puis la relancer (l’application de bureau le fait à son lancement).'

/** Erreurs Prisma connues → statut, code et message (API et nœud Atelier). */
export const PRISMA_ERRORS: Record<string, [statusCode: number, code: string, message: string]> = {
  P2025: [404, 'NOT_FOUND', 'Élément introuvable'],
  P2002: [409, 'CONFLICT', 'Valeur déjà utilisée (contrainte d’unicité)'],
  P2003: [409, 'CONFLICT', 'Référence invalide (clé étrangère)'],
  P2021: [503, 'DATABASE_NOT_MIGRATED', DATABASE_NOT_MIGRATED_MESSAGE],
  P2022: [503, 'DATABASE_NOT_MIGRATED', DATABASE_NOT_MIGRATED_MESSAGE],
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (error instanceof HttpError) {
    return reply.status(error.statusCode).send(errorBody(error.statusCode, error.code, error.message))
  }
  if (error.validation) {
    return reply.status(400).send(errorBody(400, 'VALIDATION_ERROR', validationMessage(error.validation, error.message)))
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const known = PRISMA_ERRORS[error.code]
    if (known) {
      if (known[0] >= 500) request.log.error({ err: error }, known[2])
      return reply.status(known[0]).send(errorBody(...known))
    }
  }
  const statusCode = error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500
  if (statusCode === 500) {
    request.log.error({ err: error }, 'Erreur interne')
    return reply.status(500).send(errorBody(500, 'INTERNAL_ERROR', 'Erreur interne du serveur'))
  }
  // Erreurs 4xx de Fastify (JSON mal formé, type de contenu non pris en charge…)
  return reply.status(statusCode).send(errorBody(statusCode, error.code ?? 'ERROR', error.message))
}
