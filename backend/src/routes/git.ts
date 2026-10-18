// Git & GitHub : analyse du dépôt local, commits liés, hook post-commit, Pull Requests.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { ErrorSchema, errorResponses } from '../schemas/common.ts'
import {
  CommitListQuery,
  GitHubSyncResultSchema,
  GitScanResultSchema,
  HookStatusSchema,
  ProjectCommitSchema,
  PullRequestListQuery,
  PullRequestSchema,
} from '../schemas/git.ts'
import { ProjectParams } from '../schemas/projects.ts'
import { getHook, listProjectCommits, listPullRequests, scanRepository, setHook, syncPullRequests } from '../services/git.ts'

const tags = ['Git & GitHub']

export const gitRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/projects/:projectId/git/scan',
    {
      schema: {
        tags,
        summary: 'Analyser le dépôt Git local et rattacher les commits qui citent un #ID',
        params: ProjectParams,
        response: { 200: GitScanResultSchema, ...errorResponses(400, 404) },
      },
    },
    async (request) =>
      scanRepository(app.prisma, request.params.projectId, {
        maxCommitsPerBranch: app.settings.gitScanMaxCommits,
        now: app.settings.now(),
      }),
  )

  app.get(
    '/projects/:projectId/commits',
    {
      schema: {
        tags,
        summary: 'Commits détectés (les plus récents d’abord), filtrables par élément',
        params: ProjectParams,
        querystring: CommitListQuery,
        response: { 200: Type.Array(ProjectCommitSchema), ...errorResponses(400, 404) },
      },
    },
    async (request) => listProjectCommits(app.prisma, request.params.projectId, request.query),
  )

  const hookSchema = (summary: string) => ({
    tags,
    summary,
    params: ProjectParams,
    response: { 200: HookStatusSchema, ...errorResponses(400, 404) },
  })

  app.get('/projects/:projectId/git/hook', { schema: hookSchema('État du hook post-commit du dépôt') }, async (request) =>
    getHook(app.prisma, request.params.projectId, app.settings.publicUrl),
  )
  app.put(
    '/projects/:projectId/git/hook',
    { schema: hookSchema('Installer le hook post-commit (analyse relancée à chaque commit)') },
    async (request) => setHook(app.prisma, request.params.projectId, app.settings.publicUrl, true),
  )
  app.delete(
    '/projects/:projectId/git/hook',
    { schema: hookSchema('Retirer le hook post-commit (le reste du fichier est conservé)') },
    async (request) => setHook(app.prisma, request.params.projectId, app.settings.publicUrl, false),
  )

  app.post(
    '/projects/:projectId/github/sync',
    {
      schema: {
        tags,
        summary: 'Synchroniser les Pull Requests du dépôt GitHub et les relier aux éléments',
        params: ProjectParams,
        response: { 200: GitHubSyncResultSchema, ...errorResponses(400, 404), 502: ErrorSchema },
      },
    },
    async (request) =>
      syncPullRequests(app.prisma, request.params.projectId, app.settings.github, {
        max: app.settings.githubMaxPullRequests,
        now: app.settings.now(),
      }),
  )

  app.get(
    '/projects/:projectId/pull-requests',
    {
      schema: {
        tags,
        summary: 'Pull Requests synchronisées (les plus récentes d’abord)',
        params: ProjectParams,
        querystring: PullRequestListQuery,
        response: { 200: Type.Array(PullRequestSchema), ...errorResponses(400, 404) },
      },
    },
    async (request) => listPullRequests(app.prisma, request.params.projectId, request.query),
  )
}
