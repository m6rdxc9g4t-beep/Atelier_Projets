// Cas d'usage de l'ai-bridge : état de l'IA locale, découpage d'une Story, résumé des commits d'un
// élément pour son journal d'avancement, session Claude CLI dans le dépôt du projet.
import { CLAUDE_PERMISSION_MODES, type ClaudeLauncher } from '../ai-bridge/claude-cli.ts'
import { findInstalledModel, OllamaError, type OllamaClient } from '../ai-bridge/ollama.ts'
import {
  BREAKDOWN_FORMAT,
  buildBreakdownMessages,
  buildClaudePrompt,
  buildSummaryMessages,
  cleanSummary,
  parseBreakdown,
  type SummaryCommit,
} from '../ai-bridge/prompts.ts'
import { roundTo, toDuration } from '../domain/durations.ts'
import type { PrismaClient } from '../db/client.ts'
import { GitRepositoryError, openRepository, readCommitPatch } from '../git-engine/repository.ts'
import { badGateway, badRequest, notFound } from '../http/errors.ts'
import type {
  AiStatusDto,
  BreakdownRequest,
  BreakdownResultDto,
  ClaudeLaunchRequest,
  ClaudeLaunchResultDto,
  ClaudePromptDto,
  SummarizeRequest,
  SummarizeResultDto,
} from '../schemas/ai.ts'
import { requireStory } from './common.ts'
import { toContainerRef } from './mappers.ts'
import { loadHierarchyCodes } from './work-items.ts'

export interface AiSettings {
  ollama: OllamaClient
  /** Modèle par défaut (OLLAMA_MODEL). */
  model: string
  /** Taille maximale cumulée des diffs envoyés au modèle (AI_MAX_DIFF_CHARS). */
  maxDiffChars: number
  claude: ClaudeLauncher
}

/** Commits lus au plus pour un résumé (les plus récents). */
const MAX_SUMMARY_COMMITS = 20

/**
 * Nom exact à envoyer à Ollama : « qwen2.5-coder » devient l'étiquette installée (« qwen2.5-coder:7b ») quand il
 * n'y en a qu'une. Si Ollama ne répond pas, le nom demandé est gardé (l'appel suivant expliquera l'erreur).
 */
async function resolveModel(settings: AiSettings, requested: string | undefined): Promise<string> {
  const wanted = requested ?? settings.model
  const models = await settings.ollama.listModels().catch(() => null)
  return (models && findInstalledModel(models, wanted)?.name) || wanted
}

/** Erreur d'Ollama → 502 explicite. */
function ollamaFailure(error: unknown): never {
  if (error instanceof OllamaError) {
    const code =
      error.kind === 'model'
        ? 'AI_MODEL_MISSING'
        : error.kind === 'failed'
          ? 'AI_ERROR'
          : error.kind === 'cancelled'
            ? 'AI_CANCELLED'
            : 'AI_UNAVAILABLE'
    throw badGateway(code, error.message)
  }
  throw error
}

export async function getAiStatus(settings: AiSettings): Promise<AiStatusDto> {
  const [models, claude] = await Promise.all([
    settings.ollama.listModels().then(
      (list) => ({ list, error: null }),
      (error: unknown) => ({ list: [], error: error instanceof Error ? error.message : String(error) }),
    ),
    settings.claude.status(),
  ])
  return {
    ollama: {
      url: settings.ollama.baseUrl,
      reachable: models.error === null,
      error: models.error,
      defaultModel: settings.model,
      defaultModelInstalled: findInstalledModel(models.list, settings.model) !== undefined,
      defaultModelName: findInstalledModel(models.list, settings.model)?.name ?? null,
      models: models.list,
    },
    claude,
  }
}

// --- Découpage d'une Story ---------------------------------------------------------------------------

export async function breakdownStory(
  prisma: PrismaClient,
  settings: AiSettings,
  input: BreakdownRequest,
  signal?: AbortSignal,
): Promise<BreakdownResultDto> {
  const story = await requireStory(prisma, input.storyId)
  const { epic } = story
  const project = epic.phase.project
  const [codes, existing] = await Promise.all([
    loadHierarchyCodes(prisma, project.id),
    prisma.workItem.findMany({
      where: { storyId: story.id },
      select: { id: true, type: true, title: true, estimatedHours: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    }),
  ])
  const model = await resolveModel(settings, input.model)
  const messages = buildBreakdownMessages({
    projectName: project.name,
    hoursPerDay: project.hoursPerDay,
    phase: { code: codes.phases.get(epic.phase.id) ?? '?', title: epic.phase.title },
    epic: { code: codes.epics.get(epic.id) ?? '?', title: epic.title, description: epic.description },
    story: { code: codes.stories.get(story.id) ?? '?', title: story.title, description: story.description },
    existing: existing.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      estimateDays: item.estimatedHours === null ? null : roundTo(item.estimatedHours / project.hoursPerDay, 2),
    })),
    instructions: input.instructions,
  })
  const answer = await settings.ollama.chat({ model, messages, format: BREAKDOWN_FORMAT, temperature: 0.3, signal }).catch(ollamaFailure)
  const items = parseBreakdown(
    answer,
    existing.map((item) => item.title),
  )
  if (!items) throw badGateway('AI_INVALID_RESPONSE', `Le modèle « ${model} » n’a pas renvoyé de découpage exploitable : réessayer ou changer de modèle`)
  return {
    story: toContainerRef(story, codes.stories),
    model,
    hoursPerDay: project.hoursPerDay,
    items: items.map((item) => ({
      type: item.type,
      title: item.title,
      description: item.description,
      estimate: toDuration(item.estimateDays * project.hoursPerDay, project.hoursPerDay),
    })),
  }
}

// --- Résumé des commits d'un élément ---------------------------------------------------------------

export async function summarizeCommits(
  prisma: PrismaClient,
  settings: AiSettings,
  input: SummarizeRequest,
  signal?: AbortSignal,
): Promise<SummarizeResultDto> {
  const item = await prisma.workItem.findUnique({
    where: { id: input.workItemId },
    include: {
      project: { select: { localRepoPath: true } },
      commitLinks: { include: { commit: true }, orderBy: { commit: { committedAt: 'desc' } }, take: MAX_SUMMARY_COMMITS },
    },
  })
  if (!item) throw notFound(`Élément #${input.workItemId} introuvable`)
  const commits = item.commitLinks.map((link) => link.commit).reverse()
  if (commits.length === 0) {
    throw badRequest(`Aucun commit lié à #${item.id} : citer « #${item.id} » dans les messages de commit puis analyser le dépôt`)
  }

  const warnings: string[] = []
  let repository: Awaited<ReturnType<typeof openRepository>> | null = null
  if (!item.project.localRepoPath) {
    warnings.push('Pas de dépôt Git local pour ce projet : seuls les messages de commit ont été transmis.')
  } else {
    try {
      repository = await openRepository(item.project.localRepoPath)
    } catch (error) {
      if (!(error instanceof GitRepositoryError)) throw error
      warnings.push(`${error.message} : seuls les messages de commit ont été transmis.`)
    }
  }

  const perCommit = Math.max(1500, Math.floor(settings.maxDiffChars / commits.length))
  const summaryCommits: SummaryCommit[] = []
  const report: SummarizeResultDto['commits'] = []
  for (const commit of commits) {
    const patch = repository ? await readCommitPatch(repository, commit.hash, perCommit).catch(() => null) : null
    summaryCommits.push({
      shortHash: commit.hash.slice(0, 7),
      committedAt: commit.committedAt.toISOString().slice(0, 16).replace('T', ' '),
      authorName: commit.authorName,
      message: commit.message,
      patch: patch?.patch ?? null,
    })
    report.push({
      shortHash: commit.hash.slice(0, 7),
      subject: commit.message.split('\n')[0] ?? '',
      diff: patch === null ? 'missing' : patch.truncated ? 'truncated' : 'full',
    })
  }
  if (repository && report.some((commit) => commit.diff === 'missing')) {
    warnings.push('Certains commits sont absents du dépôt local (amend, rebase) : leur message seul a été transmis.')
  }
  if (item.commitLinks.length === MAX_SUMMARY_COMMITS) warnings.push(`Seuls les ${MAX_SUMMARY_COMMITS} commits les plus récents ont été lus.`)

  const model = await resolveModel(settings, input.model)
  const answer = await settings.ollama
    .chat({
      signal,
      model,
      messages: buildSummaryMessages({
        item: { id: item.id, type: item.type, title: item.title, description: item.description, implementationLog: item.implementationLog },
        commits: summaryCommits,
      }),
      temperature: 0.2,
    })
    .catch(ollamaFailure)
  const text = cleanSummary(answer)
  if (text === '') throw badGateway('AI_INVALID_RESPONSE', `Le modèle « ${model} » a renvoyé une réponse vide : réessayer ou changer de modèle`)
  return { workItemId: item.id, model, text, commits: report, warnings }
}

// --- Claude CLI ------------------------------------------------------------------------------------

async function claudeContext(prisma: PrismaClient, workItemId: number) {
  const item = await prisma.workItem.findUnique({
    where: { id: workItemId },
    include: {
      project: { select: { id: true, localRepoPath: true } },
      story: { include: { epic: { include: { phase: true } } } },
      commitLinks: { include: { commit: true }, orderBy: { commit: { committedAt: 'desc' } }, take: 15 },
    },
  })
  if (!item) throw notFound(`Élément #${workItemId} introuvable`)
  const codes = await loadHierarchyCodes(prisma, item.project.id)
  const { story } = item
  const prompt = buildClaudePrompt({
    item: {
      id: item.id,
      type: item.type,
      title: item.title,
      status: item.status,
      description: item.description,
      implementationLog: item.implementationLog,
    },
    path: {
      phase: `PHASE ${codes.phases.get(story.epic.phase.id) ?? '?'} ${story.epic.phase.title}`,
      epic: `EPIC ${codes.epics.get(story.epic.id) ?? '?'} ${story.epic.title}`,
      story: `STORY ${codes.stories.get(story.id) ?? '?'} ${story.title}`,
    },
    commits: item.commitLinks.map(({ commit }) => ({ shortHash: commit.hash.slice(0, 7), message: commit.message })),
  })
  return { item, prompt, cwd: item.project.localRepoPath }
}

export async function getClaudePrompt(prisma: PrismaClient, workItemId: number): Promise<ClaudePromptDto> {
  const { item, prompt, cwd } = await claudeContext(prisma, workItemId)
  return { workItemId: item.id, prompt, cwd }
}

export async function launchClaude(prisma: PrismaClient, settings: AiSettings, input: ClaudeLaunchRequest): Promise<ClaudeLaunchResultDto> {
  let workItemId: number | null = null
  let cwd: string | null
  let prompt: string | null
  if (input.workItemId !== undefined) {
    const context = await claudeContext(prisma, input.workItemId)
    workItemId = context.item.id
    cwd = context.cwd
    prompt = input.prompt ?? context.prompt
  } else if (input.projectId !== undefined) {
    const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { localRepoPath: true } })
    if (!project) throw notFound(`Projet #${input.projectId} introuvable`)
    cwd = project.localRepoPath
    prompt = input.prompt ?? null
  } else {
    throw badRequest('Indiquer workItemId (session sur un élément) ou projectId (session sur le projet)')
  }
  if (!cwd) throw badRequest('Aucun dépôt Git local pour ce projet : renseigner localRepoPath dans les paramètres du projet')
  // Le dossier doit être la racine d'un dépôt Git existant (mêmes règles que l'analyse).
  await openRepository(cwd).catch((error: unknown) => {
    if (error instanceof GitRepositoryError) throw badRequest(error.message)
    throw error
  })
  const permissionMode = input.permissionMode ?? CLAUDE_PERMISSION_MODES[0]
  try {
    return await settings.claude.launch({ workItemId, cwd, prompt, permissionMode })
  } catch (error) {
    throw badGateway('CLAUDE_LAUNCH_FAILED', `Ouverture du terminal impossible : ${error instanceof Error ? error.message : String(error)}`)
  }
}
