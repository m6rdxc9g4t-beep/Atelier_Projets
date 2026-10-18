// WorkItems, saisies de temps et journal d'avancement.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { errorResponses, NoContent } from '../schemas/common.ts'
import { StoryParams } from '../schemas/hierarchy.ts'
import { ProjectParams } from '../schemas/projects.ts'
import { TimeEntryCreateSchema, TimeEntryParams, TimeEntrySchema, TimeEntryUpdateSchema } from '../schemas/time-entries.ts'
import {
  LogEntryCreateSchema,
  WorkItemCreateSchema,
  WorkItemDetailSchema,
  WorkItemListQuery,
  WorkItemParams,
  WorkItemSchema,
  WorkItemUpdateSchema,
} from '../schemas/work-items.ts'
import { createTimeEntry, deleteTimeEntry, listTimeEntries, updateTimeEntry } from '../services/time-entries.ts'
import {
  addLogEntry,
  createWorkItem,
  deleteWorkItem,
  getWorkItemDetail,
  listProjectWorkItems,
  listStoryWorkItems,
  updateWorkItem,
} from '../services/work-items.ts'

const tags = ['Éléments']
const timeTags = ['Temps']

export const workItemRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/projects/:projectId/work-items',
    {
      schema: {
        tags,
        summary: 'Lister les éléments d’un projet (filtres type, statut, phase, epic, story, recherche)',
        params: ProjectParams,
        querystring: WorkItemListQuery,
        response: { 200: Type.Array(WorkItemSchema), ...errorResponses(404) },
      },
    },
    async (request) => listProjectWorkItems(app.prisma, request.params.projectId, request.query),
  )

  app.get(
    '/stories/:storyId/work-items',
    {
      schema: {
        tags,
        summary: 'Lister les éléments d’une story',
        params: StoryParams,
        response: { 200: Type.Array(WorkItemSchema), ...errorResponses(404) },
      },
    },
    async (request) => listStoryWorkItems(app.prisma, request.params.storyId),
  )

  app.post(
    '/stories/:storyId/work-items',
    {
      schema: {
        tags,
        summary: 'Créer un élément (FEATURE, TASK ou BUG) dans une story',
        params: StoryParams,
        body: WorkItemCreateSchema,
        response: { 201: WorkItemDetailSchema, ...errorResponses(400, 404) },
      },
    },
    async (request, reply) => reply.code(201).send(await createWorkItem(app.prisma, request.params.storyId, request.body)),
  )

  app.get(
    '/work-items/:workItemId',
    {
      schema: {
        tags,
        summary: 'Fiche d’un élément : description, journal, temps, commits liés',
        params: WorkItemParams,
        response: { 200: WorkItemDetailSchema, ...errorResponses(404) },
      },
    },
    async (request) => getWorkItemDetail(app.prisma, request.params.workItemId),
  )

  app.patch(
    '/work-items/:workItemId',
    {
      schema: {
        tags,
        summary: 'Modifier un élément (statut, estimation, textes…) ou le déplacer vers une autre story',
        params: WorkItemParams,
        body: WorkItemUpdateSchema,
        response: { 200: WorkItemDetailSchema, ...errorResponses(400, 404) },
      },
    },
    async (request) => updateWorkItem(app.prisma, request.params.workItemId, request.body),
  )

  app.delete(
    '/work-items/:workItemId',
    {
      schema: { tags, summary: 'Supprimer un élément', params: WorkItemParams, response: { 204: NoContent, ...errorResponses(404) } },
    },
    async (request, reply) => {
      await deleteWorkItem(app.prisma, request.params.workItemId)
      return reply.code(204).send(null)
    },
  )

  app.post(
    '/work-items/:workItemId/log-entries',
    {
      schema: {
        tags,
        summary: 'Ajouter une entrée horodatée au journal d’avancement',
        params: WorkItemParams,
        body: LogEntryCreateSchema,
        response: { 201: WorkItemDetailSchema, ...errorResponses(400, 404) },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await addLogEntry(app.prisma, request.params.workItemId, request.body, app.settings.timeZone)),
  )

  // --- Saisies de temps ---
  app.get(
    '/work-items/:workItemId/time-entries',
    {
      schema: {
        tags: timeTags,
        summary: 'Lister les saisies de temps d’un élément',
        params: WorkItemParams,
        response: { 200: Type.Array(TimeEntrySchema), ...errorResponses(404) },
      },
    },
    async (request) => listTimeEntries(app.prisma, request.params.workItemId),
  )

  app.post(
    '/work-items/:workItemId/time-entries',
    {
      schema: {
        tags: timeTags,
        summary: 'Saisir du temps sur un élément',
        params: WorkItemParams,
        body: TimeEntryCreateSchema,
        response: { 201: TimeEntrySchema, ...errorResponses(400, 404) },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await createTimeEntry(app.prisma, request.params.workItemId, request.body, app.settings.timeZone)),
  )

  app.patch(
    '/time-entries/:timeEntryId',
    {
      schema: {
        tags: timeTags,
        summary: 'Modifier une saisie de temps',
        params: TimeEntryParams,
        body: TimeEntryUpdateSchema,
        response: { 200: TimeEntrySchema, ...errorResponses(400, 404) },
      },
    },
    async (request) => updateTimeEntry(app.prisma, request.params.timeEntryId, request.body),
  )

  app.delete(
    '/time-entries/:timeEntryId',
    {
      schema: {
        tags: timeTags,
        summary: 'Supprimer une saisie de temps',
        params: TimeEntryParams,
        response: { 204: NoContent, ...errorResponses(404) },
      },
    },
    async (request, reply) => {
      await deleteTimeEntry(app.prisma, request.params.timeEntryId)
      return reply.code(204).send(null)
    },
  )
}
