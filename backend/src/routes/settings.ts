// Réglages de l'application : GET / PATCH /api/settings (mode hors ligne / en ligne, docs/SUITE.md §5.1).
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { errorResponses } from '../schemas/common.ts'
import { AppSettingsSchema, AppSettingsUpdateSchema } from '../schemas/settings.ts'
import { getSettings, updateSettings } from '../services/settings.ts'

const tags = ['Réglages']

export const settingsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/settings',
    { schema: { tags, summary: 'Réglages de l’application (mode hors ligne / en ligne)', response: { 200: AppSettingsSchema } } },
    async () => getSettings(app.prisma),
  )
  app.patch(
    '/settings',
    {
      schema: {
        tags,
        summary: 'Modifier les réglages : activer ou couper le mode en ligne (pris en compte immédiatement)',
        body: AppSettingsUpdateSchema,
        response: { 200: AppSettingsSchema, ...errorResponses(400) },
      },
    },
    async (request) => updateSettings(app.prisma, request.body),
  )
}
