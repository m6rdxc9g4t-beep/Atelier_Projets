// IA : Ollama (local) ou Claude (CLI isolée, en ligne seulement) au choix, et sessions Claude CLI dans un terminal.
// Les propositions de l'IA ne sont jamais enregistrées directement : le frontend les affiche, l'utilisateur les
// corrige puis les crée ou les ajoute au journal.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import type { FastifyReply } from 'fastify'
import { Type } from 'typebox'
import {
  AiStatusQuery,
  AiStatusSchema,
  BreakdownRequestSchema,
  BreakdownResultSchema,
  ClaudeLaunchRequestSchema,
  ClaudeLaunchResultSchema,
  ClaudePromptQuery,
  ClaudePromptSchema,
  SummarizeRequestSchema,
  SummarizeResultSchema,
} from '../schemas/ai.ts'
import { ErrorSchema, errorResponses } from '../schemas/common.ts'
import { breakdownStory, getAiStatus, getClaudePrompt, launchClaude, summarizeCommits } from '../services/ai.ts'

const tags = ['IA locale & Claude CLI']
const gatewayError = {
  403: Type.Object(ErrorSchema.properties, { description: 'Claude demandé en mode hors ligne (CLAUDE_OFFLINE)' }),
  502: Type.Object(ErrorSchema.properties, { description: 'Ollama injoignable, Claude indisponible, modèle absent ou réponse inexploitable' }),
  504: Type.Object(ErrorSchema.properties, { description: 'Claude n’a pas répondu dans le délai (CLAUDE_TIMEOUT_MS)' }),
}

/**
 * Signal déclenché si le client abandonne la requête (dialogue fermé, « Régénérer ») avant la réponse :
 * la génération en cours dans Ollama est interrompue au lieu d'occuper le modèle jusqu'au bout.
 */
function abandonSignal(reply: FastifyReply): AbortSignal {
  const controller = new AbortController()
  reply.raw.once('close', () => {
    if (!reply.raw.writableFinished) controller.abort()
  })
  return controller.signal
}

export const aiRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/ai/status',
    {
      schema: {
        tags,
        summary: 'État des moteurs (Ollama : modèles installés ; Claude : CLI, connexion), mode en ligne et moteur retenu par Auto',
        querystring: AiStatusQuery,
        response: { 200: AiStatusSchema },
      },
    },
    async (request) => getAiStatus(app.prisma, app.settings.ai, { refresh: request.query.refresh === true }),
  )

  app.post(
    '/ai/breakdown-story',
    {
      schema: {
        tags,
        summary: 'Proposer le découpage d’une Story en Features et Tasks estimées en jours, par Ollama ou Claude (rien n’est enregistré)',
        body: BreakdownRequestSchema,
        response: { 200: BreakdownResultSchema, ...errorResponses(400, 404), ...gatewayError },
      },
    },
    async (request, reply) => breakdownStory(app.prisma, app.settings.ai, request.body, abandonSignal(reply)),
  )

  app.post(
    '/ai/summarize-commits',
    {
      schema: {
        tags,
        summary: 'Rédiger une entrée du journal d’avancement à partir des git diff des commits liés au #ID (rien n’est enregistré)',
        body: SummarizeRequestSchema,
        response: { 200: SummarizeResultSchema, ...errorResponses(400, 404), ...gatewayError },
      },
    },
    async (request, reply) => summarizeCommits(app.prisma, app.settings.ai, request.body, abandonSignal(reply)),
  )

  app.get(
    '/ai/claude/prompt',
    {
      schema: {
        tags,
        summary: 'Aperçu du prompt d’une session Claude CLI pour un élément',
        querystring: ClaudePromptQuery,
        response: { 200: ClaudePromptSchema, ...errorResponses(400, 404) },
      },
    },
    async (request) => getClaudePrompt(app.prisma, request.query.workItemId),
  )

  app.post(
    '/ai/claude/launch',
    {
      schema: {
        tags,
        summary: 'Ouvrir Claude CLI dans le dépôt du projet avec le prompt de l’élément (terminal macOS, sinon commande à copier)',
        body: ClaudeLaunchRequestSchema,
        response: {
          200: ClaudeLaunchResultSchema,
          ...errorResponses(400, 404),
          502: Type.Object(ErrorSchema.properties, { description: 'Ouverture du terminal impossible' }),
        },
      },
    },
    async (request) => launchClaude(app.prisma, app.settings.ai, request.body),
  )
}
