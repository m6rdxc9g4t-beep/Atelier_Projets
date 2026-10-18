import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { errorResponses, NoContent } from '../schemas/common.ts'
import { ProjectCreateSchema, ProjectParams, ProjectSchema, ProjectUpdateSchema } from '../schemas/projects.ts'
import { createProject, deleteProject, getProject, listProjects, updateProject } from '../services/projects.ts'

const tags = ['Projets']

export const projectRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/projects',
    { schema: { tags, summary: 'Lister les projets', response: { 200: Type.Array(ProjectSchema) } } },
    async () => listProjects(app.prisma),
  )

  app.post(
    '/projects',
    {
      schema: {
        tags,
        summary: 'Créer un projet',
        body: ProjectCreateSchema,
        response: { 201: ProjectSchema, ...errorResponses(400, 409) },
      },
    },
    async (request, reply) => reply.code(201).send(await createProject(app.prisma, request.body)),
  )

  app.get(
    '/projects/:projectId',
    { schema: { tags, summary: 'Lire un projet', params: ProjectParams, response: { 200: ProjectSchema, ...errorResponses(404) } } },
    async (request) => getProject(app.prisma, request.params.projectId),
  )

  app.patch(
    '/projects/:projectId',
    {
      schema: {
        tags,
        summary: 'Modifier un projet',
        params: ProjectParams,
        body: ProjectUpdateSchema,
        response: { 200: ProjectSchema, ...errorResponses(400, 404, 409) },
      },
    },
    async (request) => updateProject(app.prisma, request.params.projectId, request.body),
  )

  app.delete(
    '/projects/:projectId',
    {
      schema: {
        tags,
        summary: 'Supprimer un projet et tout son contenu',
        params: ProjectParams,
        response: { 204: NoContent, ...errorResponses(404) },
      },
    },
    async (request, reply) => {
      await deleteProject(app.prisma, request.params.projectId)
      return reply.code(204).send(null)
    },
  )
}
