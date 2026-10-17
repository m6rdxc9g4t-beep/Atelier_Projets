// Construction de l'application Fastify, sans écoute réseau (testable avec app.inject()).
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import type { PrismaClient } from './db/client.ts'
import { healthRoutes } from './routes/health.ts'

declare module 'fastify' {
  interface FastifyInstance {
    /** Client Prisma partagé par toutes les routes. */
    prisma: PrismaClient
  }
}

export interface BuildAppOptions {
  prisma: PrismaClient
  logger?: FastifyServerOptions['logger']
}

export async function buildApp({ prisma, logger = true }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger })

  app.decorate('prisma', prisma)
  app.addHook('onClose', async () => {
    await prisma.$disconnect()
  })

  await app.register(healthRoutes, { prefix: '/api' })

  return app
}
