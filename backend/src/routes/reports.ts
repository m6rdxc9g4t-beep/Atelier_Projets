// Vues calculées consommées telles quelles par le frontend (aucun calcul métier côté client).
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { errorResponses } from '../schemas/common.ts'
import { ProjectParams } from '../schemas/projects.ts'
import { DashboardSchema, ProjectTreeSchema, ReportQuery, TimesheetQuery, TimesheetSchema } from '../schemas/reports.ts'
import { getDashboard, getProjectTree, getTimesheet } from '../services/reports.ts'

const tags = ['Vues']

export const reportRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/projects/:projectId/dashboard',
    {
      schema: {
        tags,
        summary: 'Dashboard : santé du budget, avancement réel, histogramme des 8 statuts',
        params: ProjectParams,
        querystring: ReportQuery,
        response: { 200: DashboardSchema, ...errorResponses(400, 404) },
      },
    },
    async (request) => getDashboard(app.prisma, request.params.projectId, request.query),
  )

  app.get(
    '/projects/:projectId/tree',
    {
      schema: {
        tags,
        summary: 'Arborescence Phase > Epic > Story > Élément avec agrégats et dates (Gantt, hiérarchie)',
        params: ProjectParams,
        querystring: ReportQuery,
        response: { 200: ProjectTreeSchema, ...errorResponses(400, 404) },
      },
    },
    async (request) => getProjectTree(app.prisma, request.params.projectId, request.query),
  )

  app.get(
    '/projects/:projectId/timesheet',
    {
      schema: {
        tags,
        summary: 'Tableau des temps : budget, réalisé et bilan par élément',
        params: ProjectParams,
        querystring: TimesheetQuery,
        response: { 200: TimesheetSchema, ...errorResponses(400, 404) },
      },
    },
    async (request) => getTimesheet(app.prisma, request.params.projectId, request.query),
  )
}
