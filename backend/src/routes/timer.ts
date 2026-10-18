// Chronomètre (un seul en cours) : démarrer sur un élément, arrêter (saisie de temps créée), abandonner.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { errorResponses, NoContent } from '../schemas/common.ts'
import { TimerStartResultSchema, TimerStartSchema, TimerStateSchema, TimerStopResultSchema, TimerStopSchema } from '../schemas/timer.ts'
import { discardTimer, getTimer, startTimer, stopTimer } from '../services/timer.ts'

const tags = ['Temps']

export const timerRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const clock = () => ({ timeZone: app.settings.timeZone, now: app.settings.now() })

  app.get(
    '/timer',
    { schema: { tags, summary: 'Chronomètre en cours (ou null)', response: { 200: TimerStateSchema } } },
    async () => getTimer(app.prisma, clock()),
  )
  app.post(
    '/timer/start',
    {
      schema: {
        tags,
        summary: 'Démarrer le chronomètre sur un élément (celui en cours ailleurs est arrêté et saisi)',
        body: TimerStartSchema,
        response: { 200: TimerStartResultSchema, ...errorResponses(400, 404) },
      },
    },
    async (request) => startTimer(app.prisma, request.body, clock()),
  )
  app.post(
    '/timer/stop',
    {
      schema: {
        tags,
        summary: 'Arrêter le chronomètre : le temps écoulé devient une saisie de temps',
        body: TimerStopSchema,
        response: { 200: TimerStopResultSchema, ...errorResponses(400) },
      },
    },
    async (request) => stopTimer(app.prisma, request.body, clock()),
  )
  app.delete(
    '/timer',
    { schema: { tags, summary: 'Abandonner le chronomètre sans saisir de temps', response: { 204: NoContent, ...errorResponses(400) } } },
    async (_request, reply) => {
      await discardTimer(app.prisma)
      return reply.code(204).send(null)
    },
  )
}
