// Nœud Atelier (docs/SUITE.md §7, atelier-node/1) : manifeste, actions en snake_case, tables atelier-table/1 et
// événements, sous /api/atelier. Routes minces : chaque action est déclarée une fois dans services/atelier-manifest.ts
// (schémas compris) et délègue à services/atelier-node.ts, qui appelle les services existants.
// Erreurs au format { detail, code } (§7.5), y compris celles des gardes globaux (Host, Origin).
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import type { FastifyError, FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify'
import type { TSchema } from 'typebox'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BACKEND_ROOT } from '../config.ts'
import type { Db } from '../db/client.ts'
import { HttpError } from '../http/errors.ts'
import { IdempotencyHeaders, sendIdempotent } from '../http/idempotency.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { AtelierEventPageSchema, atelierErrors, EventsQuery, ManifestSchema } from '../schemas/atelier.ts'
import type {
  NodeLogEntry,
  NodeMilestoneReach,
  NodeTimeEntry,
  NodeWorkItemCreate,
  NodeWorkItemUpdate,
  TableOptions,
  WorkItemsQueryInput,
} from '../schemas/atelier.ts'
import type { DatasetName } from '../schemas/exports.ts'
import { listEvents } from '../services/atelier-events.ts'
import { buildManifest, fastifyPath, NODE_ACTIONS, nodeAction, type NodeActionSpec } from '../services/atelier-manifest.ts'
import {
  nodeCreateTimeEntry,
  nodeCreateWorkItem,
  nodeGetWorkItem,
  nodeListMilestones,
  nodeListProjects,
  nodeListWorkItems,
  nodeLogWorkItem,
  nodeProjectTree,
  nodeReachMilestone,
  nodeTable,
  nodeUpdateWorkItem,
} from '../services/atelier-node.ts'

const tags = ['Nœud Atelier']
const { version } = JSON.parse(readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8')) as { version: string }

/** Codes de l'API → codes communs du contrat (§7.5). */
function contractCode(statusCode: number, code: string): string {
  if (code === 'VALIDATION_ERROR' || code === 'BAD_REQUEST' || code === 'FST_ERR_CTP_EMPTY_JSON_BODY') return 'VALIDATION'
  if (code === 'ROUTE_NOT_FOUND') return 'NOT_FOUND'
  if (statusCode === 400 && code.startsWith('FST_')) return 'VALIDATION'
  return code
}

const PRISMA_ERRORS: Record<string, [number, string, string]> = {
  P2025: [404, 'NOT_FOUND', 'Élément introuvable'],
  P2002: [409, 'CONFLICT', 'Valeur déjà utilisée (contrainte d’unicité)'],
  P2003: [409, 'CONFLICT', 'Référence invalide (clé étrangère)'],
}

/** Gestionnaire d'erreurs des routes /api/atelier/* : { detail, code }. */
export function atelierErrorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const send = (statusCode: number, code: string, detail: string) => reply.status(statusCode).send({ detail, code: contractCode(statusCode, code) })
  if (error instanceof HttpError) return send(error.statusCode, error.code, error.message)
  if (error.validation) return send(400, 'VALIDATION', error.message)
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const known = PRISMA_ERRORS[error.code]
    if (known) return send(...known)
  }
  const statusCode = error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500
  if (statusCode === 500) {
    request.log.error({ err: error }, 'Erreur interne')
    return send(500, 'INTERNAL_ERROR', 'Erreur interne du serveur')
  }
  return send(statusCode, error.code ?? 'ERROR', error.message)
}

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>

export const atelierRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.setErrorHandler(atelierErrorHandler)
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({ detail: `Route ${request.method} ${request.url} introuvable`, code: 'NOT_FOUND' }),
  )
  const now = () => app.settings.now()

  app.get(
    '/manifest',
    {
      schema: {
        tags,
        summary: 'Manifeste du nœud Atelier Projets (actions, schémas d’entrée et de sortie, événements)',
        response: { 200: ManifestSchema },
      },
    },
    async () => buildManifest(version),
  )

  app.get(
    '/events',
    {
      schema: {
        tags,
        summary: 'Événements du nœud (seq croissant ; since exclusif ; gap si des événements ont été perdus)',
        querystring: EventsQuery,
        response: { 200: AtelierEventPageSchema, ...atelierErrors(400) },
      },
    },
    async (request) => listEvents(app.prisma, request.query),
  )

  /** Enregistre la route d'une action du manifeste (schémas de la déclaration, réponses et erreurs documentées). */
  const route = (id: string, handler: Handler): void => {
    const action: NodeActionSpec = nodeAction(id)
    const success = action.method === 'POST' && action.idempotency === 'header' ? 201 : 200
    const schema: Record<string, unknown> = {
      tags,
      summary: `${action.label} (${action.id})`,
      description: `${action.description} Idempotence : ${action.idempotency}.`,
      response: { [success]: action.output.schema as TSchema, ...atelierErrors(400, 403, 404, 409) },
    }
    if (action.params) schema.params = action.params
    if (action.querystring) schema.querystring = action.querystring
    if (action.body) schema.body = action.body
    if (action.idempotency === 'header') schema.headers = IdempotencyHeaders
    app.route({ method: action.method, url: fastifyPath(action).replace(/^\/atelier/, ''), schema, handler: handler as RouteHandlerMethod })
  }

  /** Écriture idempotente par en-tête : portée = identifiant de l'action, réponse 201 rejouée telle quelle. */
  const idempotent =
    (id: string, write: (request: FastifyRequest, at: Date) => (db: Db) => Promise<unknown>): Handler =>
    async (request, reply) => {
      const at = now()
      return sendIdempotent(app.prisma, request, reply, { scope: id, statusCode: 201, now: at }, write(request, at))
    }

  const params = (request: FastifyRequest) => request.params as Record<string, number | string>

  route('projects.list', async () => nodeListProjects(app.prisma))
  route('projects.tree', async (request) => nodeProjectTree(app.prisma, params(request).project_id as number))
  route('work_items.list', async (request) =>
    nodeListWorkItems(app.prisma, params(request).project_id as number, request.query as WorkItemsQueryInput, now()),
  )
  route('work_items.get', async (request) => nodeGetWorkItem(app.prisma, params(request).work_item_id as number))
  route(
    'work_items.create',
    idempotent('work_items.create', (request, at) => (db) =>
      nodeCreateWorkItem(db, params(request).story_id as number, request.body as NodeWorkItemCreate, at),
    ),
  )
  route('work_items.update', async (request) =>
    nodeUpdateWorkItem(app.prisma, params(request).work_item_id as number, request.body as NodeWorkItemUpdate, now()),
  )
  route(
    'work_items.log',
    idempotent('work_items.log', (request, at) => (db) =>
      nodeLogWorkItem(db, params(request).work_item_id as number, request.body as NodeLogEntry, { timeZone: app.settings.timeZone, now: at }),
    ),
  )
  route(
    'time_entries.create',
    idempotent('time_entries.create', (request, at) => (db) =>
      nodeCreateTimeEntry(db, params(request).work_item_id as number, request.body as NodeTimeEntry, { timeZone: app.settings.timeZone, now: at }),
    ),
  )
  route('milestones.list', async (request) => nodeListMilestones(app.prisma, params(request).project_id as number, now()))
  route('milestones.reach', async (request) =>
    nodeReachMilestone(app.prisma, params(request).milestone_id as number, (request.body as NodeMilestoneReach | undefined)?.reached_at, now()),
  )
  route('tables.get', async (request) =>
    nodeTable(app.prisma, params(request).name as DatasetName, (request.query as TableOptions).project_id, now()),
  )
}

/** Actions servies par routes/atelier.ts (les autres, comme imports.atelier_tab, désignent une route existante). */
export const SERVED_UNDER_ATELIER = NODE_ACTIONS.filter((action) => action.path.startsWith('/api/atelier/')).map((action) => action.id)
