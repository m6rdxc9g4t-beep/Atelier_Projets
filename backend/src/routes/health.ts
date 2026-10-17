// GET /api/health — l'API répond et la base SQLite est joignable.
import type { FastifyPluginAsync } from 'fastify'

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (_request, reply) => {
    const timestamp = new Date().toISOString()
    try {
      await app.prisma.$queryRaw`SELECT 1`
      return { status: 'ok', database: 'ok', timestamp }
    } catch (error) {
      app.log.error({ err: error }, 'Base SQLite injoignable')
      return reply.code(503).send({ status: 'error', database: 'unreachable', timestamp })
    }
  })
}
