// Git & GitHub : analyse du dépôt local, commits, hook post-commit, Pull Requests.
import { Type, type Static } from 'typebox'
import { WORK_ITEM_STATUSES } from '../domain/workflow.ts'
import { DateTime, Id, Nullable } from './common.ts'

export const GitScanResultSchema = Type.Object(
  {
    branches: Type.Array(Type.String(), { description: 'Branches locales lues (branche par défaut en dernier)' }),
    commitsRead: Type.Integer(),
    commitsCreated: Type.Integer(),
    linksCreated: Type.Integer({ description: 'Nouveaux liens commit ↔ élément' }),
    commitsRemoved: Type.Integer({ description: 'Commits disparus du dépôt (amend, rebase, branche supprimée) retirés' }),
    truncated: Type.Boolean({ description: 'Au moins une branche dépasse GIT_SCAN_MAX_COMMITS : les plus anciens commits ne sont pas lus' }),
    unknownReferences: Type.Array(Type.Integer(), { description: '#ID cités qui ne correspondent à aucun élément du projet' }),
    scannedAt: DateTime,
  },
  { description: 'Résultat d’une analyse du dépôt Git local' },
)
export type GitScanResultDto = Static<typeof GitScanResultSchema>

export const ProjectCommitSchema = Type.Object({
  hash: Type.String(),
  shortHash: Type.String(),
  message: Type.String(),
  authorName: Type.String(),
  authorEmail: Type.String(),
  committedAt: DateTime,
  branch: Nullable(Type.String()),
  workItemIds: Type.Array(Id),
})
export type ProjectCommitDto = Static<typeof ProjectCommitSchema>

export const CommitListQuery = Type.Object({
  workItemId: Type.Optional(Id),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, default: 100 })),
})

export const HookStatusSchema = Type.Object(
  {
    installed: Type.Boolean(),
    path: Type.String({ description: 'Fichier post-commit du dépôt' }),
    scanUrl: Type.String({ description: 'URL appelée après chaque commit' }),
  },
  { description: 'Hook post-commit d’Atelier_Projets' },
)
export type HookStatusDto = Static<typeof HookStatusSchema>

const PullRequestStateSchema = Type.Enum(['OPEN', 'MERGED', 'CLOSED'], { type: 'string' })
const LinkSourceSchema = Type.Enum(['title', 'body', 'branch'], { type: 'string', description: 'Où le #ID a été détecté' })

const pullRequestFields = {
  number: Type.Integer(),
  title: Type.String(),
  state: PullRequestStateSchema,
  draft: Type.Boolean(),
  status: Type.Enum(WORK_ITEM_STATUSES, {
    type: 'string',
    description: 'Statut du workflow affiché : brouillon → IN_PROGRESS, ouverte → IN_REVIEW, fusionnée → CLOSED, fermée → REJECTED',
  }),
  url: Type.String(),
  headBranch: Type.String(),
  baseBranch: Type.String(),
  authorLogin: Nullable(Type.String()),
  openedAt: DateTime,
  mergedAt: Nullable(DateTime),
  closedAt: Nullable(DateTime),
}

export const PullRequestSchema = Type.Object(
  { ...pullRequestFields, workItemIds: Type.Array(Id) },
  { description: 'Pull Request GitHub du projet' },
)
export type PullRequestDto = Static<typeof PullRequestSchema>

/** Pull Request vue depuis la fiche d'un élément. */
export const LinkedPullRequestSchema = Type.Object({ ...pullRequestFields, source: LinkSourceSchema })
export type LinkedPullRequestDto = Static<typeof LinkedPullRequestSchema>

export const PullRequestListQuery = Type.Object({ state: Type.Optional(Type.Array(PullRequestStateSchema)) })

export const GitHubSyncResultSchema = Type.Object(
  {
    pullRequests: Type.Integer({ description: 'Pull Requests reçues de GitHub' }),
    created: Type.Integer(),
    updated: Type.Integer(),
    linkedWorkItems: Type.Integer({ description: 'Liens Pull Request ↔ élément après synchronisation' }),
    syncedAt: DateTime,
  },
  { description: 'Résultat d’une synchronisation des Pull Requests GitHub' },
)
export type GitHubSyncResultDto = Static<typeof GitHubSyncResultSchema>
