// Moteur Claude : la CLI Claude Code de la machine (abonnement de l'utilisateur) appelée en mode « print »
// (`claude -p`), isolée comme dans Atelier Viz (docs/SUITE.md §5.3) :
// - --safe-mode : ni CLAUDE.md, ni mémoire, ni hooks, ni plugins, ni MCP de l'utilisateur ;
// - --tools "" + --strict-mcp-config + --disable-slash-commands : aucun outil (ni shell, ni fichiers, ni MCP) ;
// - --system-prompt : remplace entièrement le prompt système de Claude Code ;
// - --no-session-persistence : rien n'est écrit dans l'historique des sessions ;
// - dossier de travail temporaire vide, environnement en liste blanche (HOME, USER, PATH… ; ni ANTHROPIC_*, ni
//   secret de l'application), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 (ni télémétrie, ni mise à jour automatique).
// Le prompt système ne contient que des consignes ; les données (story, commits, diffs) passent par l'entrée
// standard, jamais dans les arguments (visibles par `ps`). Sortie JSON (`--output-format json`),
// structurée par `--json-schema` quand une forme est imposée. L'exécutant est injectable (tests).
// Distinct de claude-cli.ts, qui ouvre une session interactive dans un terminal.
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { claudeFallbackDirs, findClaudeExecutable, isRelativeCommand, relativeCommandMessage, sessionPath } from './claude-cli.ts'
import type { ChatMessage } from './ollama.ts'

/** Modèles proposés (alias de la CLI). Sonnet par défaut. */
export const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku'] as const
export type ClaudeModel = (typeof CLAUDE_MODELS)[number]
export const DEFAULT_CLAUDE_MODEL: ClaudeModel = 'sonnet'

/** Délai maximal d'une réponse par défaut (CLAUDE_TIMEOUT_MS). */
export const DEFAULT_CLAUDE_TIMEOUT_MS = 180_000
/** Durée de validité de `claude auth status` (contrat : 60 s). */
export const CLAUDE_STATUS_TTL_MS = 60_000
/**
 * Intervalle minimal entre deux revérifications forcées (`refresh`, contrat : 10 s) : `GET /api/ai/status?refresh=true`
 * se déclenche aussi depuis une page étrangère (balise <img>), qui ne doit pas pouvoir lancer la CLI en boucle.
 */
export const CLAUDE_STATUS_REFRESH_MIN_MS = 10_000
/** Méthodes d'authentification facturées à l'API (et non à l'abonnement). */
const API_KEY_AUTH_METHODS = new Set(['api_key', 'api_key_helper', 'apiKey', 'apiKeyHelper'])
/** Sortie lue au plus (protection mémoire). */
const MAX_OUTPUT_CHARS = 5_000_000

export interface RunResult {
  /** Code de sortie (null : processus tué). */
  code: number | null
  stdout: string
  stderr: string
}

export interface RunOptions {
  /** Texte écrit sur l'entrée standard (null : entrée fermée tout de suite). */
  input: string | null
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  signal?: AbortSignal
}

/** Lance un exécutable ; lève ClaudeError (timeout, cancelled, failed) si le processus ne peut aboutir. */
export type ClaudeRunner = (executable: string, args: readonly string[], options: RunOptions) => Promise<RunResult>

/**
 * Échec d'un appel à Claude. kind :
 * - missing : CLI introuvable ;
 * - auth : CLI non connectée ;
 * - timeout : délai dépassé ;
 * - cancelled : génération abandonnée par l'appelant ;
 * - failed : autre erreur (réponse illisible, erreur renvoyée par Claude).
 */
export class ClaudeError extends Error {
  readonly kind: 'missing' | 'auth' | 'timeout' | 'cancelled' | 'failed'

  constructor(kind: ClaudeError['kind'], message: string) {
    super(message)
    this.name = 'ClaudeError'
    this.kind = kind
  }
}

export interface ClaudeEngineStatus {
  /** Exécutable trouvé. */
  installed: boolean
  executable: string | null
  /** `claude auth status` : connectée (null si non vérifié). */
  loggedIn: boolean | null
  authMethod: string | null
  /** Exécutable trouvé et CLI connectée. */
  available: boolean
  /** Raison de l'indisponibilité, en français. */
  error: string | null
  /** Avertissement non bloquant (clé API au lieu de l'abonnement). */
  warning: string | null
  /** Date de la vérification (ISO). */
  checkedAt: string
}

export interface ClaudeRequest {
  model: ClaudeModel
  /** Conversation au format d'Ollama : les messages « system » deviennent --system-prompt. */
  messages: ChatMessage[]
  signal?: AbortSignal
}

export interface ClaudeEngine {
  readonly timeoutMs: number
  /** Exécutable + `claude auth status`, en cache 60 s (refresh : relecture, au plus toutes les 10 s). */
  status(options?: { refresh?: boolean }): Promise<ClaudeEngineStatus>
  /** Réponse texte (champ `result`). */
  chat(request: ClaudeRequest): Promise<string>
  /** Réponse contrainte par un schéma JSON (--json-schema) : texte JSON de `structured_output`. */
  chatJson(request: ClaudeRequest & { schema: Record<string, unknown> }): Promise<string>
}

export interface ClaudeEngineOptions {
  /** Commande ou chemin (CLAUDE_CLI, défaut « claude »). */
  command?: string
  searchPath?: string
  fallbackDirs?: readonly string[]
  /** Délai maximal d'une réponse (CLAUDE_TIMEOUT_MS). */
  timeoutMs?: number
  runner?: ClaudeRunner
  /** Environnement de base transmis à la CLI (défaut : process.env), nettoyé par claudeEnvironment(). */
  env?: NodeJS.ProcessEnv
  now?: () => number
}

const DEFAULT_SYSTEM_PROMPT = 'Tu es l’assistant d’Atelier Projets, un gestionnaire de projets agiles. Réponds en français.'

/** Arguments exacts d'un appel isolé (docs/SUITE.md §5.3). */
export function claudeArguments(options: { model: ClaudeModel; system: string; maxTurns: number; schema?: Record<string, unknown> }): string[] {
  return [
    '-p',
    '--safe-mode',
    '--output-format',
    'json',
    '--tools',
    '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--max-turns',
    String(options.maxTurns),
    '--model',
    options.model,
    '--system-prompt',
    options.system,
    ...(options.schema ? ['--json-schema', JSON.stringify(options.schema)] : []),
  ]
}

/** Variables transmises à la CLI (docs/SUITE.md §5.3), plus les LC_* ; rien d'autre. */
export const CLAUDE_ENV_ALLOWLIST = ['HOME', 'USER', 'LOGNAME', 'PATH', 'SHELL', 'LANG', 'TMPDIR', 'TZ', 'CLAUDE_CONFIG_DIR'] as const

/**
 * Environnement de la CLI, en liste blanche (docs/SUITE.md §5.3) : ni ANTHROPIC_* (clé, jeton, adresse : facturation
 * par l'abonnement), ni CLAUDE_CODE_USE_BEDROCK / VERTEX, ni secret de l'application (ATELIER_IMPORT_TOKEN,
 * GITHUB_TOKEN…). PATH : dossier de l'exécutable en tête, sans entrée relative ni node_modules/.bin (sessionPath).
 * CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 : ni télémétrie, ni rapport d'erreur, ni mise à jour automatique.
 */
export function claudeEnvironment(base: NodeJS.ProcessEnv, executable: string): NodeJS.ProcessEnv {
  const allowed = new Set<string>(CLAUDE_ENV_ALLOWLIST)
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && (allowed.has(key) || key.startsWith('LC_'))) env[key] = value
  }
  env.PATH = sessionPath(base.PATH, executable)
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  return env
}

const ROLE_LABEL: Record<ChatMessage['role'], string> = { system: 'Système', user: 'Utilisateur', assistant: 'Assistant' }

/** `claude -p` reçoit un seul prompt : prompt système à part, l'historique devient une transcription. */
export function formatConversation(messages: readonly ChatMessage[]): { system: string; prompt: string } {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n')
  const turns = messages.filter((message) => message.role !== 'system')
  const prompt =
    turns.length === 1
      ? (turns[0]?.content ?? '')
      : `Voici la conversation jusqu’ici :\n\n${turns.map((message) => `${ROLE_LABEL[message.role]} : ${message.content}`).join('\n\n')}\n\nRéponds au dernier message de l’utilisateur, sans préfixe.`
  return { system: system || DEFAULT_SYSTEM_PROMPT, prompt }
}

/** Objet JSON final (`type: "result"`) de la sortie standard, ou null. */
export function parseResult(stdout: string): Record<string, unknown> | null {
  const lines = stdout.trim().split('\n').reverse()
  for (const candidate of [stdout.trim(), ...lines]) {
    try {
      const data: unknown = JSON.parse(candidate)
      if (typeof data === 'object' && data !== null && !Array.isArray(data) && (data as { type?: unknown }).type === 'result') {
        return data as Record<string, unknown>
      }
    } catch {
      /* ligne suivante */
    }
  }
  return null
}

/** Exécutant par défaut : processus enfant, entrée standard, délai et annulation (SIGTERM puis SIGKILL). */
export const spawnRunner: ClaudeRunner = (executable, args, { input, cwd, env, timeoutMs, signal }) =>
  new Promise<RunResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ClaudeError('cancelled', 'Génération annulée'))
      return
    }
    const child = spawn(executable, [...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const stop = () => {
      child.kill('SIGTERM')
      setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 2000).unref()
    }
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      action()
    }
    const timer = setTimeout(() => {
      stop()
      finish(() => reject(new ClaudeError('timeout', `Claude n’a pas répondu en ${Math.round(timeoutMs / 1000)} s (CLAUDE_TIMEOUT_MS)`)))
    }, timeoutMs)
    const onAbort = () => {
      stop()
      finish(() => reject(new ClaudeError('cancelled', 'Génération annulée')))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      if (stderr.length < 100_000) stderr += chunk
    })
    child.on('error', (error) => finish(() => reject(new ClaudeError('failed', `Lancement de Claude CLI impossible : ${error.message}`))))
    child.on('close', (code) => finish(() => resolve({ code, stdout, stderr })))
    child.stdin.on('error', () => undefined)
    child.stdin.end(input ?? '')
  })

const NOT_FOUND_MESSAGE = 'Claude CLI introuvable : installer Claude Code puis lancer « claude auth login » (ou renseigner CLAUDE_CLI)'
/** CLI introuvable, ou CLAUDE_CLI relatif (refusé). */
function notFoundMessage(command: string): string {
  return isRelativeCommand(command) ? relativeCommandMessage(command) : NOT_FOUND_MESSAGE
}
const LOGIN_MESSAGE = 'Claude CLI non connectée : lancer « claude auth login » dans un terminal'

export function createClaudeEngine(options: ClaudeEngineOptions = {}): ClaudeEngine {
  const command = options.command?.trim() || 'claude'
  const searchPath = options.searchPath ?? process.env.PATH
  const fallbackDirs = options.fallbackDirs ?? claudeFallbackDirs()
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLAUDE_TIMEOUT_MS
  const runner = options.runner ?? spawnRunner
  const now = options.now ?? Date.now
  let cached: { at: number; value: Promise<ClaudeEngineStatus> } | null = null

  /** Lance la CLI dans un dossier temporaire vide, supprimé ensuite. */
  async function run(executable: string, args: readonly string[], input: string | null, limitMs: number, signal?: AbortSignal): Promise<RunResult> {
    const cwd = await mkdtemp(path.join(tmpdir(), 'atelier-projets-claude-'))
    try {
      return await runner(executable, args, { input, cwd, env: claudeEnvironment(options.env ?? process.env, executable), timeoutMs: limitMs, signal })
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async function readStatus(): Promise<ClaudeEngineStatus> {
    const checkedAt = new Date(now()).toISOString()
    const executable = await findClaudeExecutable(command, searchPath, fallbackDirs)
    const base = { executable, checkedAt, warning: null }
    if (executable === null) return { ...base, installed: false, loggedIn: null, authMethod: null, available: false, error: notFoundMessage(command) }
    let info: { loggedIn?: unknown; authMethod?: unknown }
    try {
      const result = await run(executable, ['auth', 'status'], null, 15_000)
      info = JSON.parse(result.stdout.trim() || '{}') as typeof info
    } catch {
      return {
        ...base,
        installed: true,
        loggedIn: null,
        authMethod: null,
        available: false,
        error: '« claude auth status » illisible : mettre la CLI à jour (« claude update »)',
      }
    }
    const authMethod = typeof info.authMethod === 'string' ? info.authMethod : null
    if (info.loggedIn !== true) return { ...base, installed: true, loggedIn: false, authMethod, available: false, error: LOGIN_MESSAGE }
    return {
      ...base,
      installed: true,
      loggedIn: true,
      authMethod,
      available: true,
      error: null,
      warning:
        authMethod !== null && API_KEY_AUTH_METHODS.has(authMethod) ? 'La CLI utilise une clé API : facturation à l’API, pas à l’abonnement' : null,
    }
  }

  async function ask(request: ClaudeRequest, schema?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const executable = await findClaudeExecutable(command, searchPath, fallbackDirs)
    if (executable === null) throw new ClaudeError('missing', notFoundMessage(command))
    const { system, prompt } = formatConversation(request.messages)
    // Sortie structurée : un tour de plus, pour la réponse contrainte par le schéma (comme Viz).
    const args = claudeArguments({ model: request.model, system, maxTurns: schema ? 2 : 1, ...(schema && { schema }) })
    const result = await run(executable, args, prompt, timeoutMs, request.signal)
    const payload = parseResult(result.stdout)
    if (payload === null) {
      let detail = (result.stderr || result.stdout).trim().slice(0, 300)
      if (/unknown option/i.test(detail)) detail += ' — mettre la CLI à jour : « claude update »'
      throw new ClaudeError('failed', `Réponse illisible de Claude CLI${detail ? ` : ${detail}` : ''}`)
    }
    if (payload.is_error === true || result.code !== 0) {
      const detail = typeof payload.result === 'string' && payload.result.trim() !== '' ? payload.result.trim().slice(0, 300) : 'erreur inconnue'
      const auth = /log ?in|authenticat|api key|credential/i.test(detail)
      if (auth) cached = null
      throw new ClaudeError(auth ? 'auth' : 'failed', auth ? `${LOGIN_MESSAGE} (${detail})` : `Erreur de Claude : ${detail}`)
    }
    return payload
  }

  return {
    timeoutMs,
    status({ refresh = false } = {}) {
      const age = cached === null ? Infinity : now() - cached.at
      if (cached === null || age >= CLAUDE_STATUS_TTL_MS || (refresh && age >= CLAUDE_STATUS_REFRESH_MIN_MS)) {
        cached = { at: now(), value: readStatus() }
      }
      return cached.value
    },
    async chat(request) {
      const payload = await ask(request)
      if (typeof payload.result !== 'string') throw new ClaudeError('failed', 'Réponse de Claude sans texte (champ « result » absent)')
      return payload.result
    },
    async chatJson(request) {
      const payload = await ask(request, request.schema)
      const structured = payload.structured_output
      if (typeof structured === 'object' && structured !== null) return JSON.stringify(structured)
      if (typeof payload.result === 'string') return payload.result
      throw new ClaudeError('failed', 'Réponse de Claude sans sortie structurée')
    },
  }
}
