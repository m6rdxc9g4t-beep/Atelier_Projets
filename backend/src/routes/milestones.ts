import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { errorResponses, NoContent } from '../schemas/common.ts'
import { MilestoneCreateSchema, MilestoneParams, MilestoneSchema, MilestoneUpdateSchema } from '../schemas/milestones.ts'
import { ProjectParams } from '../schemas/projects.ts'
import { createMilestone, deleteMilestone, getMilestone, listMilestones, updateMilestone } from '../services/milestones.ts'

const tags = ['Jalons']

export const milestoneRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/projects/:projectId/milestones',
    {
      schema: {
        tags,
        summary: 'Lister les jalons d’un projet (par date)',
        params: ProjectParams,
        response: { 200: Type.Array(MilestoneSchema), ...errorResponses(404) },
      },
    },
    async (request) => listMilestones(app.prisma, request.params.projectId),
  )

  app.post(
    '/projects/:projectId/milestones',
    {
      schema: {
        tags,
        summary: 'Créer un jalon (« + Jalon »), de projet ou de phase',
        params: ProjectParams,
        body: MilestoneCreateSchema,
        response: { 201: MilestoneSchema, ...errorResponses(400, 404) },
      },
    },
    async (request, reply) => reply.code(201).send(await createMilestone(app.prisma, request.params.projectId, request.body)),
  )

  app.get(
    '/milestones/:milestoneId',
    { schema: { tags, summary: 'Lire un jalon', params: MilestoneParams, response: { 200: MilestoneSchema, ...errorResponses(404) } } },
    async (request) => getMilestone(app.prisma, request.params.milestoneId),
  )

  app.patch(
    '/milestones/:milestoneId',
    {
      schema: {
        tags,
        summary: 'Modifier un jalon (reachedAt : date d’atteinte, null = non atteint)',
        params: MilestoneParams,
        body: MilestoneUpdateSchema,
        response: { 200: MilestoneSchema, ...errorResponses(400, 404) },
      },
    },
    async (request) => updateMilestone(app.prisma, request.params.milestoneId, request.body),
  )

  app.delete(
    '/milestones/:milestoneId',
    { schema: { tags, summary: 'Supprimer un jalon', params: MilestoneParams, response: { 204: NoContent, ...errorResponses(404) } } },
    async (request, reply) => {
      await deleteMilestone(app.prisma, request.params.milestoneId)
      return reply.code(204).send(null)
    },
  )
}
