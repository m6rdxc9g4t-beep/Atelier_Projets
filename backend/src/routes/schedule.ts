// Planification du Gantt : dépendances entre éléments, déplacement d'une barre avec son contenu,
// résolution des conflits de dépendances.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { errorResponses, NoContent } from '../schemas/common.ts'
import { EpicParams, PhaseParams, StoryParams } from '../schemas/hierarchy.ts'
import { ProjectParams } from '../schemas/projects.ts'
import { DependencyCreateSchema, DependencyParams, ResolveResultSchema, ShiftResultSchema, ShiftSchema } from '../schemas/schedule.ts'
import { WorkItemParams } from '../schemas/work-items.ts'
import { addDependency, removeDependency, resolveScheduleConflicts, shiftContainer } from '../services/schedule.ts'

const tags = ['Planification']

export const scheduleRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/work-items/:workItemId/dependencies',
    {
      schema: {
        tags,
        summary: 'Ajouter un prédécesseur : cet élément ne commence qu’après sa fin (même projet, sans boucle)',
        params: WorkItemParams,
        body: DependencyCreateSchema,
        response: { 204: NoContent, ...errorResponses(400, 404, 409) },
      },
    },
    async (request, reply) => {
      await addDependency(app.prisma, request.params.workItemId, request.body)
      return reply.code(204).send(null)
    },
  )

  app.delete(
    '/work-items/:workItemId/dependencies/:predecessorId',
    {
      schema: {
        tags,
        summary: 'Retirer un prédécesseur',
        params: DependencyParams,
        response: { 204: NoContent, ...errorResponses(400, 404) },
      },
    },
    async (request, reply) => {
      await removeDependency(app.prisma, request.params.workItemId, request.params.predecessorId)
      return reply.code(204).send(null)
    },
  )

  app.post(
    '/projects/:projectId/schedule/resolve',
    {
      schema: {
        tags,
        summary: 'Replanifier les éléments en conflit avec leurs dépendances (décalés, durées conservées)',
        params: ProjectParams,
        response: { 200: ResolveResultSchema, ...errorResponses(400, 404) },
      },
    },
    async (request) => resolveScheduleConflicts(app.prisma, request.params.projectId),
  )

  const shift = { tags, body: ShiftSchema, response: { 200: ShiftResultSchema, ...errorResponses(400, 404) } }
  app.post(
    '/phases/:phaseId/shift',
    { schema: { ...shift, summary: 'Déplacer une phase avec son contenu et ses jalons', params: PhaseParams } },
    async (request) => shiftContainer(app.prisma, 'phase', request.params.phaseId, request.body),
  )
  app.post(
    '/epics/:epicId/shift',
    { schema: { ...shift, summary: 'Déplacer un epic avec son contenu', params: EpicParams } },
    async (request) => shiftContainer(app.prisma, 'epic', request.params.epicId, request.body),
  )
  app.post(
    '/stories/:storyId/shift',
    { schema: { ...shift, summary: 'Déplacer une story avec ses éléments', params: StoryParams } },
    async (request) => shiftContainer(app.prisma, 'story', request.params.storyId, request.body),
  )
}
