// Cas d'usage du git-engine : analyse du dépôt local, commits liés, hook post-commit, Pull Requests GitHub.
import type { Db } from '../db/client.ts'
import { GitHubError, type GitHubClient, type GitHubPullRequest } from '../git-engine/github.ts'
import { hookStatus, installHook, uninstallHook } from '../git-engine/hook.ts'
import {
  branchWorkItemId,
  commitReferences,
  parseReferences,
  pullRequestStatus,
  type PullRequestState,
  type WorkItemReference,
} from '../git-engine/references.ts'
import { GitRepositoryError, readRepositoryCommits } from '../git-engine/repository.ts'
import type { Project, PullRequest } from '../generated/prisma/client.ts'
import { badGateway, badRequest } from '../http/errors.ts'
import type {
  GitHubSyncResultDto,
  GitScanResultDto,
  HookStatusDto,
  LinkedPullRequestDto,
  ProjectCommitDto,
  PullRequestDto,
} from '../schemas/git.ts'
import { requireProject } from './common.ts'

const BATCH_SIZE = 500
const MAX_UNKNOWN_REFERENCES = 50

async function projectWorkItemIds(prisma: Db, projectId: number): Promise<Set<number>> {
  const items = await prisma.workItem.findMany({ where: { projectId }, select: { id: true } })
  return new Set(items.map((item) => item.id))
}

function repositoryPath(project: Project): string {
  if (!project.localRepoPath) {
    throw badRequest('Aucun dépôt Git local pour ce projet : renseigner localRepoPath (chemin absolu)')
  }
  return project.localRepoPath
}

async function withRepository<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof GitRepositoryError) throw badRequest(error.message)
    throw error
  }
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

// --- Analyse du dépôt local ----------------------------------------------------------------------

/**
 * Lit les commits du dépôt local et rattache ceux qui citent un #ID du projet. Idempotent : un commit déjà
 * connu garde sa branche et ne reçoit que les liens manquants (élément créé après coup) ; un commit disparu
 * du dépôt (amend, rebase, branche supprimée) est retiré, sauf lecture tronquée par la limite.
 */
const running = new Map<number, Promise<unknown>>()

/** Une seule analyse à la fois par projet (hook et bouton peuvent se croiser) : les suivantes attendent leur tour. */
function oneAtATime<T>(projectId: number, task: () => Promise<T>): Promise<T> {
  const previous = running.get(projectId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(task)
  running.set(projectId, next)
  void next.finally(() => {
    if (running.get(projectId) === next) running.delete(projectId)
  }).catch(() => undefined)
  return next
}

export function scanRepository(
  prisma: Db,
  projectId: number,
  options: { maxCommitsPerBranch: number; now: Date },
): Promise<GitScanResultDto> {
  return oneAtATime(projectId, () => scan(prisma, projectId, options))
}

async function scan(
  prisma: Db,
  projectId: number,
  options: { maxCommitsPerBranch: number; now: Date },
): Promise<GitScanResultDto> {
  const project = await requireProject(prisma, projectId)
  const repoPath = repositoryPath(project)
  const stored = await prisma.gitCommit.findMany({
    where: { projectId },
    select: { id: true, hash: true, message: true, links: { select: { workItemId: true } } },
  })
  const known = new Map(stored.map((commit) => [commit.hash, commit]))
  const { branches, commits, reachable, truncated } = await withRepository(() =>
    readRepositoryCommits(repoPath, {
      defaultBranch: project.defaultBranch,
      maxPerBranch: options.maxCommitsPerBranch,
      known: new Set(known.keys()),
    }),
  )

  const workItemIds = await projectWorkItemIds(prisma, projectId)
  const unknown = new Set<number>()
  const references = (message: string): WorkItemReference[] =>
    commitReferences(message).filter((reference) => {
      if (workItemIds.has(reference.workItemId)) return true
      unknown.add(reference.workItemId)
      return false
    })

  let commitsCreated = 0
  let linksCreated = 0
  for (const batch of chunks(commits, BATCH_SIZE)) {
    await prisma.$transaction(async (tx) => {
      for (const commit of batch) {
        const refs = references(commit.message)
        await tx.gitCommit.create({
          data: {
            projectId,
            hash: commit.hash,
            authorName: commit.authorName,
            authorEmail: commit.authorEmail,
            committedAt: commit.committedAt,
            message: commit.message,
            branch: commit.branch,
            links: { create: refs.map(({ workItemId, keyword }) => ({ workItemId, keyword })) },
          },
        })
        commitsCreated += 1
        linksCreated += refs.length
      }
    })
  }

  // Commits déjà connus et toujours présents : liens manquants (messages stockés, rien à relire dans Git).
  const missing = stored.filter((commit) => reachable.has(commit.hash)).flatMap((commit) => {
    const linked = new Set(commit.links.map((link) => link.workItemId))
    return references(commit.message)
      .filter((reference) => !linked.has(reference.workItemId))
      .map(({ workItemId, keyword }) => ({ commitId: commit.id, workItemId, keyword }))
  })
  for (const batch of chunks(missing, BATCH_SIZE)) {
    await prisma.$transaction(batch.map((data) => prisma.gitCommitLink.create({ data })))
  }
  linksCreated += missing.length

  const gone = truncated ? [] : stored.filter((commit) => !reachable.has(commit.hash)).map((commit) => commit.id)
  if (gone.length > 0) await prisma.gitCommit.deleteMany({ where: { id: { in: gone } } })

  await prisma.project.update({ where: { id: projectId }, data: { gitScannedAt: options.now } })
  return {
    branches,
    commitsRead: reachable.size,
    commitsCreated,
    linksCreated,
    commitsRemoved: gone.length,
    truncated,
    unknownReferences: [...unknown].sort((a, b) => a - b).slice(0, MAX_UNKNOWN_REFERENCES),
    scannedAt: options.now.toISOString(),
  }
}

export async function listProjectCommits(
  prisma: Db,
  projectId: number,
  query: { workItemId?: number; limit?: number },
): Promise<ProjectCommitDto[]> {
  await requireProject(prisma, projectId)
  const commits = await prisma.gitCommit.findMany({
    where: { projectId, ...(query.workItemId !== undefined && { links: { some: { workItemId: query.workItemId } } }) },
    include: { links: { select: { workItemId: true }, orderBy: { workItemId: 'asc' } } },
    orderBy: [{ committedAt: 'desc' }, { id: 'desc' }],
    take: query.limit ?? 100,
  })
  return commits.map((commit) => ({
    hash: commit.hash,
    shortHash: commit.hash.slice(0, 7),
    message: commit.message,
    authorName: commit.authorName,
    authorEmail: commit.authorEmail,
    committedAt: commit.committedAt.toISOString(),
    branch: commit.branch,
    workItemIds: commit.links.map((link) => link.workItemId),
  }))
}

// --- Hook post-commit ----------------------------------------------------------------------------

function scanUrl(publicUrl: string, projectId: number): string {
  return `${publicUrl.replace(/\/+$/, '')}/api/projects/${projectId}/git/scan`
}

export async function getHook(prisma: Db, projectId: number, publicUrl: string): Promise<HookStatusDto> {
  const project = await requireProject(prisma, projectId)
  const status = await withRepository(() => hookStatus(repositoryPath(project), projectId))
  return { ...status, scanUrl: scanUrl(publicUrl, projectId) }
}

export async function setHook(
  prisma: Db,
  projectId: number,
  publicUrl: string,
  install: boolean,
): Promise<HookStatusDto> {
  const project = await requireProject(prisma, projectId)
  const url = scanUrl(publicUrl, projectId)
  const repoPath = repositoryPath(project)
  const status = await withRepository(() =>
    install ? installHook(repoPath, projectId, url) : uninstallHook(repoPath, projectId),
  )
  return { ...status, scanUrl: url }
}

// --- Pull Requests GitHub ------------------------------------------------------------------------

function stateOf(pull: GitHubPullRequest): PullRequestState {
  if (pull.merged_at) return 'MERGED'
  return pull.state === 'open' ? 'OPEN' : 'CLOSED'
}

/** #ID d'une PR, avec l'origine de la détection (titre, puis corps, puis nom de branche). */
function pullRequestReferences(pull: GitHubPullRequest): Map<number, 'title' | 'body' | 'branch'> {
  const found = new Map<number, 'title' | 'body' | 'branch'>()
  for (const { workItemId } of parseReferences(pull.title)) found.set(workItemId, 'title')
  for (const { workItemId } of parseReferences(pull.body ?? '')) if (!found.has(workItemId)) found.set(workItemId, 'body')
  const fromBranch = branchWorkItemId(pull.head.ref)
  if (fromBranch !== null && !found.has(fromBranch)) found.set(fromBranch, 'branch')
  return found
}

/**
 * Importe les Pull Requests du dépôt GitHub du projet et les relie aux éléments cités (#ID dans le titre ou
 * le corps, numéro en tête de nom de branche). Les statuts des éléments ne sont pas modifiés.
 */
export async function syncPullRequests(
  prisma: Db,
  projectId: number,
  github: GitHubClient,
  options: { max: number; now: Date },
): Promise<GitHubSyncResultDto> {
  const project = await requireProject(prisma, projectId)
  if (!project.githubOwner || !project.githubRepo) {
    throw badRequest('Aucun dépôt GitHub pour ce projet : renseigner githubOwner et githubRepo')
  }

  let pulls: GitHubPullRequest[]
  try {
    pulls = await github.listPullRequests(project.githubOwner, project.githubRepo, { max: options.max })
  } catch (error) {
    if (error instanceof GitHubError) throw badGateway('GITHUB_ERROR', error.message)
    throw error
  }

  const workItemIds = await projectWorkItemIds(prisma, projectId)
  const existing = new Set(
    (await prisma.pullRequest.findMany({ where: { projectId }, select: { number: true } })).map((pr) => pr.number),
  )
  let created = 0
  let linkedWorkItems = 0

  for (const batch of chunks(pulls, BATCH_SIZE)) {
    await prisma.$transaction(async (tx) => {
      for (const pull of batch) {
        const data = {
          title: pull.title,
          body: pull.body ?? '',
          state: stateOf(pull),
          draft: pull.draft ?? false,
          url: pull.html_url,
          headBranch: pull.head.ref,
          baseBranch: pull.base.ref,
          authorLogin: pull.user?.login ?? null,
          openedAt: new Date(pull.created_at),
          closedAt: pull.closed_at ? new Date(pull.closed_at) : null,
          mergedAt: pull.merged_at ? new Date(pull.merged_at) : null,
        }
        const record = await tx.pullRequest.upsert({
          where: { projectId_number: { projectId, number: pull.number } },
          create: { projectId, number: pull.number, ...data },
          update: data,
        })
        if (!existing.has(pull.number)) created += 1

        const links = [...pullRequestReferences(pull)].filter(([workItemId]) => workItemIds.has(workItemId))
        await tx.pullRequestLink.deleteMany({ where: { pullRequestId: record.id } })
        for (const [workItemId, source] of links) {
          await tx.pullRequestLink.create({ data: { pullRequestId: record.id, workItemId, source } })
        }
        linkedWorkItems += links.length
      }
    })
  }

  await prisma.project.update({ where: { id: projectId }, data: { githubSyncedAt: options.now } })
  return { pullRequests: pulls.length, created, updated: pulls.length - created, linkedWorkItems, syncedAt: options.now.toISOString() }
}

function pullRequestFields(pr: PullRequest) {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: pr.draft,
    status: pullRequestStatus(pr),
    url: pr.url,
    headBranch: pr.headBranch,
    baseBranch: pr.baseBranch,
    authorLogin: pr.authorLogin,
    openedAt: pr.openedAt.toISOString(),
    mergedAt: pr.mergedAt?.toISOString() ?? null,
    closedAt: pr.closedAt?.toISOString() ?? null,
  }
}

export async function listPullRequests(
  prisma: Db,
  projectId: number,
  query: { state?: PullRequestState[] },
): Promise<PullRequestDto[]> {
  await requireProject(prisma, projectId)
  const pulls = await prisma.pullRequest.findMany({
    where: { projectId, ...(query.state && { state: { in: query.state } }) },
    include: { links: { select: { workItemId: true }, orderBy: { workItemId: 'asc' } } },
    orderBy: { number: 'desc' },
  })
  return pulls.map((pr) => ({ ...pullRequestFields(pr), workItemIds: pr.links.map((link) => link.workItemId) }))
}

/** Pull Requests liées à un élément, pour sa fiche (les plus récentes d'abord). */
export function toLinkedPullRequests(links: Array<{ source: string; pullRequest: PullRequest }>): LinkedPullRequestDto[] {
  return [...links]
    .sort((a, b) => b.pullRequest.number - a.pullRequest.number)
    .map(({ source, pullRequest }) => ({
      ...pullRequestFields(pullRequest),
      source: source === 'title' || source === 'body' ? source : 'branch',
    }))
}
