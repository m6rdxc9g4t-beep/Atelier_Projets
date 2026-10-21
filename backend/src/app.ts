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
import { allowedHosts, createLocalOnlyGuard } from './http/local-only.ts'
import { suiteCorsHook } from './http/suite-cors.ts'
import { createValidatorCompiler } from './http/validation.ts'
import { createClaudeLauncher } from './ai-bridge/claude-cli.ts'
import { createClaudeEngine } from './ai-bridge/claude-print.ts'
import { createOllamaClient } from './ai-bridge/ollama.ts'
import { createOctokitClient, type GitHubClient } from './git-engine/github.ts'
import { aiRoutes } from './routes/ai.ts'
import { atelierRoutes } from './routes/atelier.ts'
import { scheduleRoutes } from './routes/schedule.ts'
import { timerRoutes } from './routes/timer.ts'
import { backupRoutes } from './routes/backups.ts'
import type { BackupManager } from './services/backups.ts'
import type { AiSettings } from './services/ai.ts'
import { gitRoutes } from './routes/git.ts'
import { healthRoutes } from './routes/health.ts'
import { hierarchyRoutes } from './routes/hierarchy.ts'
import { milestoneRoutes } from './routes/milestones.ts'
import { projectRoutes } from './routes/projects.ts'
import { reportRoutes } from './routes/reports.ts'
import { settingsRoutes } from './routes/settings.ts'
import { suiteRoutes } from './routes/suite.ts'
import { workItemRoutes } from './routes/work-items.ts'

export interface AppSettings {
  /** Fuseau IANA des horodatages lisibles (journal d'avancement, date du jour par défaut). */
  timeZone: string
  /** Horloge (remplaçable dans les tests). */
  now: () => Date
  /** URL de l'API appelée par le hook post-commit. */
  publicUrl: string
  /** Commits lus au plus par branche. */
  gitScanMaxCommits: number
  /** Pull Requests lues au plus par synchronisation. */
  githubMaxPullRequests: number
  /** Client GitHub (Octokit, ou simulé dans les tests). */
  github: GitHubClient
  /** IA locale (Ollama), moteur Claude et session Claude CLI (simulés dans les tests). */
  ai: AiSettings
  /** Sauvegardes de la base (null : base en mémoire ou désactivées). */
  backups: BackupManager | null
  /** Jeton exigé par l'import Atelier Tab (ATELIER_IMPORT_TOKEN) ; undefined = pas de jeton. */
  importToken: string | undefined
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
  publicUrl?: string
  gitScanMaxCommits?: number
  githubMaxPullRequests?: number
  github?: GitHubClient
  ai?: Partial<AiSettings>
  /** Hôtes acceptés en plus des hôtes locaux (en-têtes Host et Origin). */
  allowedHosts?: readonly string[]
  backups?: BackupManager | null
  /** Jeton de l'import Atelier Tab (ATELIER_IMPORT_TOKEN). */
  importToken?: string
}

const { version } = JSON.parse(readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8')) as { version: string }

export async function buildApp({
  prisma,
  logger = true,
  timeZone = systemTimeZone(),
  now = () => new Date(),
  publicUrl = 'http://127.0.0.1:3000',
  gitScanMaxCommits = 5000,
  githubMaxPullRequests = 500,
  github = createOctokitClient({}),
  ai = {},
  allowedHosts: extraHosts = [],
  backups = null,
  importToken,
}: BuildAppOptions): Promise<App> {
  const app = Fastify({ logger }).withTypeProvider<TypeBoxTypeProvider>()

  app.setValidatorCompiler(createValidatorCompiler())
  app.decorate('prisma', prisma)
  const aiSettings: AiSettings = {
    ollama: ai.ollama ?? createOllamaClient({ baseUrl: 'http://localhost:11434', timeoutMs: 180_000 }),
    model: ai.model ?? 'qwen2.5-coder',
    maxDiffChars: ai.maxDiffChars ?? 24_000,
    claude: ai.claude ?? createClaudeLauncher(),
    claudeEngine: ai.claudeEngine ?? createClaudeEngine(),
  }
  app.decorate('settings', { timeZone, now, publicUrl, gitScanMaxCommits, githubMaxPullRequests, github, ai: aiSettings, backups, importToken })
  app.addHook('onClose', async () => {
    backups?.stop()
    await prisma.$disconnect()
  })
  app.setErrorHandler(errorHandler)
  // CORS des routes de la suite d'abord : une réponse d'erreur du garde reste lisible par l'appelant.
  app.addHook('onRequest', suiteCorsHook)
  app.addHook('onRequest', createLocalOnlyGuard(allowedHosts(undefined, [new URL(publicUrl).host, ...extraHosts])))
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
        title: 'Atelier Projets — API',
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
        { name: 'Sauvegardes', description: 'Copies de la base SQLite (automatiques et manuelles)' },
        { name: 'Planification', description: 'Dépendances, déplacements du Gantt, chemin critique' },
        { name: 'Git & GitHub', description: 'Analyse du dépôt local, hook post-commit, Pull Requests' },
        { name: 'Réglages', description: 'Mode hors ligne / en ligne (docs/SUITE.md §5.1)' },
        {
          name: 'IA locale & Claude CLI',
          description:
            'Découpage de Story et résumé des commits par Ollama (local) ou Claude (CLI isolée, en ligne seulement) ; sessions Claude CLI dans un terminal',
        },
        { name: 'Vues', description: 'Dashboard, arborescence (Gantt) et tableau des temps calculés' },
        {
          name: 'Suite Atelier',
          description: 'Import DataFlow depuis Atelier Tab, jeux de données pour Atelier Viz (docs/SUITE.md)',
        },
        {
          name: 'Nœud Atelier',
          description:
            'Manifeste, actions en snake_case, tables atelier-table/1 et événements pour Atelier Nexus (docs/SUITE.md §7, atelier-node/1) ; erreurs { detail, code }',
        },
      ],
    },
  })
  await app.register(swaggerUi, { routePrefix: '/api/docs' })

  await app.register(
    async (api) => {
      await api.register(healthRoutes)
      await api.register(settingsRoutes)
      await api.register(projectRoutes)
      await api.register(hierarchyRoutes)
      await api.register(workItemRoutes)
      await api.register(milestoneRoutes)
      await api.register(reportRoutes)
      await api.register(gitRoutes)
      await api.register(aiRoutes)
      await api.register(scheduleRoutes)
      await api.register(timerRoutes)
      await api.register(backupRoutes)
      await api.register(suiteRoutes)
      await api.register(atelierRoutes, { prefix: '/atelier' })
    },
    { prefix: '/api' },
  )

  return app
}
