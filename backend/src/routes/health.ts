// GET /api/health — l'API répond et la base SQLite est joignable.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'

const HealthSchema = Type.Object({
  status: Type.Enum(['ok', 'error'], { type: 'string' }),
  database: Type.Enum(['ok', 'unreachable'], { type: 'string' }),
  timestamp: Type.String({ format: 'date-time' }),
})

export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/health',
    { schema: { tags: ['Santé'], summary: 'État de l’API et de la base SQLite', response: { 200: HealthSchema, 503: HealthSchema } } },
    async (_request, reply) => {
      const timestamp = new Date().toISOString()
      try {
        await app.prisma.$queryRaw`SELECT 1`
        return { status: 'ok' as const, database: 'ok' as const, timestamp }
      } catch (error) {
        app.log.error({ err: error }, 'Base SQLite injoignable')
        return reply.code(503).send({ status: 'error', database: 'unreachable', timestamp })
      }
    },
  )
}
