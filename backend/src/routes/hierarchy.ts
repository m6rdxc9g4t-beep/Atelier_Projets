// Phases (d'un projet), Epics (d'une phase), Stories (d'un epic).
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { errorResponses, NoContent } from '../schemas/common.ts'
import {
  ContainerCreateSchema,
  EpicParams,
  EpicSchema,
  EpicUpdateSchema,
  PhaseParams,
  PhaseSchema,
  PhaseUpdateSchema,
  StoryParams,
  StorySchema,
  StoryUpdateSchema,
} from '../schemas/hierarchy.ts'
import { ProjectParams } from '../schemas/projects.ts'
import {
  createEpic,
  createPhase,
  createStory,
  deleteEpic,
  deletePhase,
  deleteStory,
  getEpic,
  getPhase,
  getStory,
  listEpics,
  listPhases,
  listStories,
  updateEpic,
  updatePhase,
  updateStory,
} from '../services/hierarchy.ts'

const tags = ['Hiérarchie']

export const hierarchyRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // --- Phases ---
  app.get(
    '/projects/:projectId/phases',
    {
      schema: { tags, summary: 'Lister les phases d’un projet', params: ProjectParams, response: { 200: Type.Array(PhaseSchema), ...errorResponses(400, 404) } },
    },
    async (request) => listPhases(app.prisma, request.params.projectId),
  )
  app.post(
    '/projects/:projectId/phases',
    {
      schema: {
        tags,
        summary: 'Créer une phase',
        params: ProjectParams,
        body: ContainerCreateSchema,
        response: { 201: PhaseSchema, ...errorResponses(400, 404) },
      },
    },
    async (request, reply) => reply.code(201).send(await createPhase(app.prisma, request.params.projectId, request.body)),
  )
  app.get(
    '/phases/:phaseId',
    { schema: { tags, summary: 'Lire une phase', params: PhaseParams, response: { 200: PhaseSchema, ...errorResponses(400, 404) } } },
    async (request) => getPhase(app.prisma, request.params.phaseId),
  )
  app.patch(
    '/phases/:phaseId',
    {
      schema: {
        tags,
        summary: 'Modifier une phase',
        params: PhaseParams,
        body: PhaseUpdateSchema,
        response: { 200: PhaseSchema, ...errorResponses(400, 404) },
      },
    },
    async (request) => updatePhase(app.prisma, request.params.phaseId, request.body),
  )
  app.delete(
    '/phases/:phaseId',
    {
      schema: {
        tags,
        summary: 'Supprimer une phase (ses jalons restent rattachés au projet)',
        params: PhaseParams,
        response: { 204: NoContent, ...errorResponses(400, 404) },
      },
    },
    async (request, reply) => {
      await deletePhase(app.prisma, request.params.phaseId, app.settings.now())
      return reply.code(204).send(null)
    },
  )

  // --- Epics ---
  app.get(
    '/phases/:phaseId/epics',
    {
      schema: { tags, summary: 'Lister les epics d’une phase', params: PhaseParams, response: { 200: Type.Array(EpicSchema), ...errorResponses(400, 404) } },
    },
    async (request) => listEpics(app.prisma, request.params.phaseId),
  )
  app.post(
    '/phases/:phaseId/epics',
    {
      schema: {
        tags,
        summary: 'Créer un epic',
        params: PhaseParams,
        body: ContainerCreateSchema,
        response: { 201: EpicSchema, ...errorResponses(400, 404) },
      },
    },
    async (request, reply) => reply.code(201).send(await createEpic(app.prisma, request.params.phaseId, request.body)),
  )
  app.get(
    '/epics/:epicId',
    { schema: { tags, summary: 'Lire un epic', params: EpicParams, response: { 200: EpicSchema, ...errorResponses(400, 404) } } },
    async (request) => getEpic(app.prisma, request.params.epicId),
  )
  app.patch(
    '/epics/:epicId',
    {
      schema: {
        tags,
        summary: 'Modifier ou déplacer un epic',
        params: EpicParams,
        body: EpicUpdateSchema,
        response: { 200: EpicSchema, ...errorResponses(400, 404) },
      },
    },
    async (request) => updateEpic(app.prisma, request.params.epicId, request.body),
  )
  app.delete(
    '/epics/:epicId',
    { schema: { tags, summary: 'Supprimer un epic', params: EpicParams, response: { 204: NoContent, ...errorResponses(400, 404) } } },
    async (request, reply) => {
      await deleteEpic(app.prisma, request.params.epicId, app.settings.now())
      return reply.code(204).send(null)
    },
  )

  // --- Stories ---
  app.get(
    '/epics/:epicId/stories',
    {
      schema: { tags, summary: 'Lister les stories d’un epic', params: EpicParams, response: { 200: Type.Array(StorySchema), ...errorResponses(400, 404) } },
    },
    async (request) => listStories(app.prisma, request.params.epicId),
  )
  app.post(
    '/epics/:epicId/stories',
    {
      schema: {
        tags,
        summary: 'Créer une story',
        params: EpicParams,
        body: ContainerCreateSchema,
        response: { 201: StorySchema, ...errorResponses(400, 404) },
      },
    },
    async (request, reply) => reply.code(201).send(await createStory(app.prisma, request.params.epicId, request.body)),
  )
  app.get(
    '/stories/:storyId',
    { schema: { tags, summary: 'Lire une story', params: StoryParams, response: { 200: StorySchema, ...errorResponses(400, 404) } } },
    async (request) => getStory(app.prisma, request.params.storyId),
  )
  app.patch(
    '/stories/:storyId',
    {
      schema: {
        tags,
        summary: 'Modifier ou déplacer une story',
        params: StoryParams,
        body: StoryUpdateSchema,
        response: { 200: StorySchema, ...errorResponses(400, 404) },
      },
    },
    async (request) => updateStory(app.prisma, request.params.storyId, request.body),
  )
  app.delete(
    '/stories/:storyId',
    { schema: { tags, summary: 'Supprimer une story', params: StoryParams, response: { 204: NoContent, ...errorResponses(400, 404) } } },
    async (request, reply) => {
      await deleteStory(app.prisma, request.params.storyId, app.settings.now())
      return reply.code(204).send(null)
    },
  )
}
