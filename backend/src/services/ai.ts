// Cas d'usage de l'ai-bridge : état des moteurs, découpage d'une Story, résumé des commits d'un élément pour
// son journal d'avancement (par Ollama ou Claude, docs/SUITE.md §5), session Claude CLI dans le dépôt du projet.
import { CLAUDE_PERMISSION_MODES, type ClaudeLauncher } from '../ai-bridge/claude-cli.ts'
import { CLAUDE_MODELS, ClaudeError, DEFAULT_CLAUDE_MODEL, type ClaudeEngine, type ClaudeModel } from '../ai-bridge/claude-print.ts'
import { findInstalledModel, OllamaError, type ChatMessage, type OllamaClient } from '../ai-bridge/ollama.ts'
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
import { badGateway, badRequest, forbidden, HttpError, notFound } from '../http/errors.ts'
import type {
  AiEngine,
  AiStatusDto,
  BreakdownRequest,
  BreakdownResultDto,
  ClaudeLaunchRequest,
  ClaudeLaunchResultDto,
  ClaudePromptDto,
  EngineChoice,
  SummarizeRequest,
  SummarizeResultDto,
} from '../schemas/ai.ts'
import { requireStory } from './common.ts'
import { toContainerRef } from './mappers.ts'
import { isOnline, OFFLINE_MESSAGE } from './settings.ts'
import { loadHierarchyCodes } from './work-items.ts'

export interface AiSettings {
  ollama: OllamaClient
  /** Modèle par défaut (OLLAMA_MODEL). */
  model: string
  /** Taille maximale cumulée des diffs envoyés au modèle (AI_MAX_DIFF_CHARS). */
  maxDiffChars: number
  /** Session interactive de Claude CLI dans un terminal. */
  claude: ClaudeLauncher
  /** Moteur Claude (claude -p isolé). */
  claudeEngine: ClaudeEngine
}

/** Commits lus au plus pour un résumé (les plus récents). */
const MAX_SUMMARY_COMMITS = 20
/** Part du budget en dessous de laquelle le diff d'un commit n'est pas lu (message seul). */
const MIN_PATCH_CHARS = 200

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

/** Moteur Claude utilisable : en ligne, CLI installée et connectée (la connexion n'est pas vérifiée hors ligne). */
async function claudeEngineState(prisma: PrismaClient, settings: AiSettings, refresh = false) {
  const online = await isOnline(prisma)
  if (!online) return { online, engine: null }
  return { online, engine: await settings.claudeEngine.status({ refresh }) }
}

export async function getAiStatus(prisma: PrismaClient, settings: AiSettings, options: { refresh?: boolean } = {}): Promise<AiStatusDto> {
  const [models, launcher, { online, engine }] = await Promise.all([
    settings.ollama.listModels().then(
      (list) => ({ list, error: null }),
      (error: unknown) => ({ list: [], error: error instanceof Error ? error.message : String(error) }),
    ),
    settings.claude.status(),
    claudeEngineState(prisma, settings, options.refresh),
  ])
  const installed = engine ? engine.installed : launcher.available
  const available = engine?.available === true
  return {
    onlineMode: online,
    auto: available ? 'claude' : 'ollama',
    maxDiffChars: settings.maxDiffChars,
    ollama: {
      url: settings.ollama.baseUrl,
      reachable: models.error === null,
      error: models.error,
      defaultModel: settings.model,
      defaultModelInstalled: findInstalledModel(models.list, settings.model) !== undefined,
      defaultModelName: findInstalledModel(models.list, settings.model)?.name ?? null,
      models: models.list,
    },
    claude: {
      available,
      installed,
      loggedIn: engine?.loggedIn ?? null,
      authMethod: engine?.authMethod ?? null,
      error: !online ? 'Désactivé : mode hors ligne' : (engine?.error ?? null),
      warning: engine?.warning ?? null,
      checkedAt: engine?.checkedAt ?? null,
      models: [...CLAUDE_MODELS],
      defaultModel: DEFAULT_CLAUDE_MODEL,
      timeoutMs: settings.claudeEngine.timeoutMs,
      version: launcher.version,
      command: engine?.executable ?? launcher.command,
      canOpenTerminal: launcher.canOpenTerminal,
      terminalApp: launcher.terminalApp,
    },
  }
}

// --- Choix du moteur -----------------------------------------------------------------------------------

interface ResolvedEngine {
  engine: AiEngine
  /** Modèle Ollama (étiquette installée) ou alias Claude. */
  model: string
}

/**
 * Moteur d'une requête (docs/SUITE.md §5.2) : « ollama » tel quel ; « claude » refusé hors ligne (403) ou
 * indisponible (502) ; « auto » = Claude si en ligne et disponible, sinon Ollama.
 */
async function resolveEngine(
  prisma: PrismaClient,
  settings: AiSettings,
  input: { engine?: EngineChoice; model?: string; claudeModel?: ClaudeModel },
): Promise<ResolvedEngine> {
  const choice = input.engine ?? 'auto'
  const claudeModel = input.claudeModel ?? DEFAULT_CLAUDE_MODEL
  if (choice === 'claude') {
    const { online, engine } = await claudeEngineState(prisma, settings)
    if (!online) throw forbidden('CLAUDE_OFFLINE', OFFLINE_MESSAGE)
    if (!engine?.available) throw badGateway('CLAUDE_UNAVAILABLE', engine?.error ?? 'Claude est indisponible')
    return { engine: 'claude', model: claudeModel }
  }
  if (choice === 'auto') {
    const { engine } = await claudeEngineState(prisma, settings)
    if (engine?.available) return { engine: 'claude', model: claudeModel }
  }
  return { engine: 'ollama', model: await resolveModel(settings, input.model) }
}

/** Erreur de Claude → 502 explicite (504 pour un délai dépassé). */
function claudeFailure(error: unknown): never {
  if (error instanceof ClaudeError) {
    if (error.kind === 'timeout') throw new HttpError(504, 'AI_TIMEOUT', error.message)
    const code = error.kind === 'cancelled' ? 'AI_CANCELLED' : error.kind === 'failed' ? 'AI_ERROR' : 'CLAUDE_UNAVAILABLE'
    throw badGateway(code, error.message)
  }
  throw error
}

/** Envoie la conversation au moteur retenu ; format : schéma JSON imposé (sortie structurée). */
async function generate(
  settings: AiSettings,
  resolved: ResolvedEngine,
  request: { messages: ChatMessage[]; format?: Record<string, unknown>; temperature: number; signal?: AbortSignal },
): Promise<string> {
  if (resolved.engine === 'claude') {
    const ask = { model: resolved.model as ClaudeModel, messages: request.messages, signal: request.signal }
    return (request.format ? settings.claudeEngine.chatJson({ ...ask, schema: request.format }) : settings.claudeEngine.chat(ask)).catch(claudeFailure)
  }
  return settings.ollama
    .chat({ model: resolved.model, messages: request.messages, temperature: request.temperature, signal: request.signal, ...(request.format && { format: request.format }) })
    .catch(ollamaFailure)
}

const ENGINE_LABEL: Record<AiEngine, string> = { ollama: 'Le modèle', claude: 'Claude, modèle' }

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
  const resolved = await resolveEngine(prisma, settings, input)
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
  const answer = await generate(settings, resolved, { messages, format: BREAKDOWN_FORMAT, temperature: 0.3, signal })
  const items = parseBreakdown(
    answer,
    existing.map((item) => item.title),
  )
  if (!items) {
    throw badGateway(
      'AI_INVALID_RESPONSE',
      `${ENGINE_LABEL[resolved.engine]} « ${resolved.model} » n’a pas renvoyé de découpage exploitable : réessayer ou changer de modèle`,
    )
  }
  return {
    story: toContainerRef(story, codes.stories),
    engine: resolved.engine,
    model: resolved.model,
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

  // Budget AI_MAX_DIFF_CHARS partagé entre les commits : chacun reçoit une part égale de ce qui reste, et ce
  // qu'un petit diff n'utilise pas profite aux suivants. Le total envoyé ne dépasse jamais maxDiffChars.
  let remaining = settings.maxDiffChars
  const summaryCommits: SummaryCommit[] = []
  const report: SummarizeResultDto['commits'] = []
  for (const [index, commit] of commits.entries()) {
    const share = Math.floor(remaining / (commits.length - index))
    const omitted = repository !== null && share < MIN_PATCH_CHARS
    const patch = repository && !omitted ? await readCommitPatch(repository, commit.hash, share).catch(() => null) : null
    remaining -= patch?.patch.length ?? 0
    summaryCommits.push({
      shortHash: commit.hash.slice(0, 7),
      committedAt: commit.committedAt.toISOString().slice(0, 16).replace('T', ' '),
      authorName: commit.authorName,
      message: commit.message,
      patch: omitted ? '' : (patch?.patch ?? null),
    })
    report.push({
      shortHash: commit.hash.slice(0, 7),
      subject: commit.message.split('\n')[0] ?? '',
      diff: omitted || patch?.truncated ? 'truncated' : patch === null ? 'missing' : 'full',
    })
  }
  if (repository && report.some((commit) => commit.diff === 'missing')) {
    warnings.push('Certains commits sont absents du dépôt local (amend, rebase) : leur message seul a été transmis.')
  }
  if (item.commitLinks.length === MAX_SUMMARY_COMMITS) warnings.push(`Seuls les ${MAX_SUMMARY_COMMITS} commits les plus récents ont été lus.`)

  const resolved = await resolveEngine(prisma, settings, input)
  const answer = await generate(settings, resolved, {
    signal,
    messages: buildSummaryMessages({
      item: { id: item.id, type: item.type, title: item.title, description: item.description, implementationLog: item.implementationLog },
      commits: summaryCommits,
    }),
    temperature: 0.2,
  })
  const text = cleanSummary(answer)
  if (text === '') {
    throw badGateway('AI_INVALID_RESPONSE', `${ENGINE_LABEL[resolved.engine]} « ${resolved.model} » a renvoyé une réponse vide : réessayer ou changer de modèle`)
  }
  return { workItemId: item.id, engine: resolved.engine, model: resolved.model, text, commits: report, warnings }
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
