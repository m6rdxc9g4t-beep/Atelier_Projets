// Suite Atelier (docs/SUITE.md §4) : import DataFlow depuis Atelier Tab et jeux de données pour Atelier Viz.
// Routes minces : validation par les schémas, logique dans services/atelier-tab-import.ts et services/exports.ts.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import type { FastifyRequest } from 'fastify'
import { isSameOriginRequest } from '../http/suite-cors.ts'
import {
  DataflowEnvelopeSchema,
  ImportHeaders,
  ImportPreviewSchema,
  ImportQuery,
  ImportResultSchema,
} from '../schemas/atelier-tab.ts'
import { errorResponses } from '../schemas/common.ts'
import { DatasetInfoSchema, DatasetParams, DatasetQuery, DatasetSchema } from '../schemas/exports.ts'
import { Type } from 'typebox'
import {
  assertImportToken,
  importFromAtelierTab,
  previewAtelierTabImport,
  type ImportRequest,
} from '../services/atelier-tab-import.ts'
import { getDataset, listDatasets } from '../services/exports.ts'

/** Taille maximale d'une enveloppe DataFlow (10 000 lignes de quelques colonnes). */
const IMPORT_BODY_LIMIT = 20 * 1024 * 1024

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

export const suiteRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const importSchema = {
    tags: ['Suite Atelier'],
    querystring: ImportQuery,
    headers: ImportHeaders,
    body: DataflowEnvelopeSchema,
  }
  const toRequest = (request: FastifyRequest<{ Body: ImportRequest['envelope']; Querystring: ImportRequest['options'] }>): ImportRequest => ({
    envelope: request.body,
    options: request.query,
    headers: {
      idempotencyKey: header(request, 'idempotency-key'),
      schemaVersion: header(request, 'x-atelier-schema-version'),
    },
  })
  /**
   * Jeton ATELIER_IMPORT_TOKEN, contrôlé dans onRequest : avant la lecture et la validation du corps (jusqu'à 20 Mo),
   * après le CORS et le garde local (hooks globaux). Exigé des appels externes — sans Origin (webhook, relais de l'app
   * de bureau Tab) ou d'une autre origine (Tab dans le navigateur) — mais pas de l'interface de Projets (même origine).
   */
  const requireImportToken = async (request: FastifyRequest): Promise<void> => {
    if (!app.settings.importToken || isSameOriginRequest(request)) return
    assertImportToken(app.settings.importToken, header(request, 'authorization'))
  }

  app.post(
    '/imports/atelier-tab/preview',
    {
      bodyLimit: IMPORT_BODY_LIMIT,
      config: { suiteCors: true },
      onRequest: requireImportToken,
      schema: {
        ...importSchema,
        summary: 'Aperçu d’un import DataFlow v2.1.0 d’Atelier Tab (rien n’est modifié)',
        response: { 200: ImportPreviewSchema, ...errorResponses(400, 401, 403, 404, 413, 422) },
      },
    },
    async (request) => previewAtelierTabImport(app.prisma, toRequest(request)),
  )

  app.post(
    '/imports/atelier-tab',
    {
      bodyLimit: IMPORT_BODY_LIMIT,
      config: { suiteCors: true },
      onRequest: requireImportToken,
      schema: {
        ...importSchema,
        summary: 'Import DataFlow v2.1.0 d’Atelier Tab : crée ou met à jour les éléments (externalRef), idempotent par Idempotency-Key',
        response: { 200: ImportResultSchema, ...errorResponses(400, 401, 403, 404, 409, 413, 422) },
      },
    },
    async (request, reply) => {
      const { result, replayed } = await importFromAtelierTab(app.prisma, toRequest(request), app.settings.now())
      if (replayed) reply.header('idempotency-replayed', 'true')
      return result
    },
  )

  // Requêtes de contrôle CORS (preflight) des navigateurs : en-têtes posés par suiteCorsHook.
  for (const url of ['/imports/atelier-tab/preview', '/imports/atelier-tab']) {
    app.options(url, { config: { suiteCors: true }, schema: { hide: true } }, async (_request, reply) => reply.code(204).send())
  }

  app.get(
    '/exports/datasets',
    {
      schema: {
        tags: ['Suite Atelier'],
        summary: 'Jeux de données proposés à Atelier Viz (nom, libellé, description, nombre de lignes)',
        response: { 200: Type.Array(DatasetInfoSchema) },
      },
    },
    async () => listDatasets(app.prisma),
  )

  app.get(
    '/exports/datasets/:name',
    {
      schema: {
        tags: ['Suite Atelier'],
        summary: 'Contenu d’un jeu de données (colonnes typées et lignes), tous projets ou un seul',
        params: DatasetParams,
        querystring: DatasetQuery,
        response: { 200: DatasetSchema, ...errorResponses(400, 404) },
      },
    },
    async (request) => getDataset(app.prisma, request.params.name, request.query, app.settings.now()),
  )
}
