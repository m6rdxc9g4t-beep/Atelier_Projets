// Construction de l'application Fastify, sans écoute réseau (testable avec app.inject()).
// Validation et typage par TypeBox, erreurs au format unique, documentation OpenAPI sur /api/docs.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyServerOptions,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify'
import { BACKEND_ROOT, systemTimeZone } from './config.ts'
import type { PrismaClient } from './db/client.ts'
import { errorHandler } from './http/errors.ts'
import { createValidatorCompiler } from './http/validation.ts'
import { healthRoutes } from './routes/health.ts'
import { hierarchyRoutes } from './routes/hierarchy.ts'
import { milestoneRoutes } from './routes/milestones.ts'
import { projectRoutes } from './routes/projects.ts'
import { reportRoutes } from './routes/reports.ts'
import { workItemRoutes } from './routes/work-items.ts'

export interface AppSettings {
  /** Fuseau IANA des horodatages lisibles (journal d'avancement, date du jour par défaut). */
  timeZone: string
  /** Horloge (remplaçable dans les tests). */
  now: () => Date
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Client Prisma partagé par toutes les routes. */
    prisma: PrismaClient
    settings: AppSettings
  }
}

export type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>

export interface BuildAppOptions {
  prisma: PrismaClient
  logger?: FastifyServerOptions['logger']
  timeZone?: string
  now?: () => Date
}

const { version } = JSON.parse(readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8')) as { version: string }

export async function buildApp({
  prisma,
  logger = true,
  timeZone = systemTimeZone(),
  now = () => new Date(),
}: BuildAppOptions): Promise<App> {
  const app = Fastify({ logger }).withTypeProvider<TypeBoxTypeProvider>()

  app.setValidatorCompiler(createValidatorCompiler())
  app.decorate('prisma', prisma)
  app.decorate('settings', { timeZone, now })
  app.addHook('onClose', async () => {
    await prisma.$disconnect()
  })
  app.setErrorHandler(errorHandler)
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      code: 'ROUTE_NOT_FOUND',
      message: `Route ${request.method} ${request.url} introuvable`,
    }),
  )

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Atelier_Projets — API',
        version,
        description:
          'API REST locale : hiérarchie Projet > Phase > Epic > Story > Élément, temps, jalons et vues calculées. ' +
          'Durées stockées en heures, restituées en heures et en jours (1 jour = hoursPerDay heures).',
      },
      tags: [
        { name: 'Santé' },
        { name: 'Projets' },
        { name: 'Hiérarchie', description: 'Phases, Epics et Stories' },
        { name: 'Éléments', description: 'FEATURE, TASK, BUG : fiche, journal d’avancement' },
        { name: 'Temps', description: 'Saisies de temps' },
        { name: 'Jalons' },
        { name: 'Vues', description: 'Dashboard, arborescence (Gantt) et tableau des temps calculés' },
      ],
    },
  })
  await app.register(swaggerUi, { routePrefix: '/api/docs' })

  await app.register(
    async (api) => {
      await api.register(healthRoutes)
      await api.register(projectRoutes)
      await api.register(hierarchyRoutes)
      await api.register(workItemRoutes)
      await api.register(milestoneRoutes)
      await api.register(reportRoutes)
    },
    { prefix: '/api' },
  )

  return app
}
