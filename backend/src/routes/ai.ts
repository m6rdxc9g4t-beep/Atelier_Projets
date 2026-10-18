// IA locale (Ollama : Qwen, Gemma) et Claude CLI. Les propositions de l'IA ne sont jamais enregistrées
// directement : le frontend les affiche, l'utilisateur les corrige puis les crée ou les ajoute au journal.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import type { FastifyReply } from 'fastify'
import { Type } from 'typebox'
import {
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
  502: Type.Object(ErrorSchema.properties, { description: 'Ollama injoignable, modèle absent ou réponse inexploitable' }),
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
    { schema: { tags, summary: 'État d’Ollama (modèles installés) et de Claude CLI', response: { 200: AiStatusSchema } } },
    async () => getAiStatus(app.settings.ai),
  )

  app.post(
    '/ai/breakdown-story',
    {
      schema: {
        tags,
        summary: 'Proposer le découpage d’une Story en Features et Tasks estimées en jours (rien n’est enregistré)',
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
