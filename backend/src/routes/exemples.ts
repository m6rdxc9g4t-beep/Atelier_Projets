// Exemples de la suite : histoires fictives reliées d'une app à l'autre (« Exemples de la suite »).
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { errorResponses, NoContent } from '../schemas/common.ts'
import { ExempleChargeSchema, ExempleHistoireSchema, ExempleParams } from '../schemas/exemples.ts'
import { listExemples, loadExemple, removeExemple } from '../services/exemples.ts'

const tags = ['Exemples de la suite']

export const exempleRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const clock = () => ({ timeZone: app.settings.timeZone, now: app.settings.now() })

  app.get(
    '/exemples-suite',
    { schema: { tags, summary: 'Lister les exemples de la suite', response: { 200: Type.Array(ExempleHistoireSchema) } } },
    async () => listExemples(app.prisma, app.settings.exemplesDir),
  )

  app.post(
    '/exemples-suite/:histoire',
    {
      schema: {
        tags,
        summary: 'Charger un exemple (projet, éléments, temps, jalons)',
        params: ExempleParams,
        response: { 200: ExempleChargeSchema, ...errorResponses(400, 404, 409) },
      },
    },
    async (request) => loadExemple(app.prisma, app.settings.exemplesDir, request.params.histoire, clock()),
  )

  app.delete(
    '/exemples-suite/:histoire',
    {
      schema: {
        tags,
        summary: 'Retirer un exemple (supprime le projet qu’il a créé)',
        params: ExempleParams,
        response: { 204: NoContent, ...errorResponses(400, 404) },
      },
    },
    async (request, reply) => {
      await removeExemple(app.prisma, app.settings.exemplesDir, request.params.histoire, app.settings.now())
      return reply.code(204).send(null)
    },
  )
}
