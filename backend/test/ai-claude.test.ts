// Moteur Claude (claude -p isolé) et choix du moteur (docs/SUITE.md §5) : drapeaux d'isolation exacts,
// environnement sans ANTHROPIC_API_KEY, sortie structurée, erreurs de la CLI (absente, non connectée, délai),
// réglage hors ligne / en ligne, routage auto / ollama / claude et refus 403 hors ligne.
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import { findClaudeExecutable, type ClaudeCliStatus, type ClaudeLauncher } from '../src/ai-bridge/claude-cli.ts'
import {
  claudeArguments,
  claudeEnvironment,
  ClaudeError,
  CLAUDE_STATUS_TTL_MS,
  createClaudeEngine,
  formatConversation,
  parseResult,
  type ClaudeEngine,
  type ClaudeEngineStatus,
  type ClaudeRequest,
  type ClaudeRunner,
  type RunOptions,
} from '../src/ai-bridge/claude-print.ts'
import type { ChatRequest, OllamaClient, OllamaModel } from '../src/ai-bridge/ollama.ts'
import { BREAKDOWN_FORMAT } from '../src/ai-bridge/prompts.ts'
import { createTestRepo, type TestRepo } from './helpers/git-repo.ts'
import { call, createTestContext, type TestContext } from './helpers/test-app.ts'

const ISOLATION = ['-p', '--safe-mode', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']

let dir = ''
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'atelier-claude-print-'))
})
after(() => rm(dir, { recursive: true, force: true }))

/** Fausse CLI exécutable (script shell). */
async function fakeCli(name: string, script: string): Promise<string> {
  const bin = path.join(dir, name)
  await mkdir(bin, { recursive: true })
  const file = path.join(bin, 'claude')
  await writeFile(file, `#!/bin/sh\n${script}\n`)
  await chmod(file, 0o755)
  return file
}

interface RunnerCall {
  executable: string
  args: readonly string[]
  options: RunOptions
  cwdEntries: string[]
}

/** Exécutant simulé : réponses en file, appels enregistrés (dossier de travail inspecté pendant l'appel). */
function scriptedRunner(replies: ({ stdout: string; code?: number; stderr?: string } | Error)[]) {
  const calls: RunnerCall[] = []
  const runner: ClaudeRunner = async (executable, args, options) => {
    calls.push({ executable, args, options, cwdEntries: await readdir(options.cwd) })
    const reply = replies.shift() ?? { stdout: '' }
    if (reply instanceof Error) throw reply
    return { code: reply.code ?? 0, stdout: reply.stdout, stderr: reply.stderr ?? '' }
  }
  return { runner, calls }
}

const result = (fields: Record<string, unknown>) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, ...fields })
const LOGGED_IN = { stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' }) }

describe('moteur Claude : appel isolé de la CLI', () => {
  it('drapeaux d’isolation exacts, schéma en option', () => {
    assert.deepEqual(claudeArguments({ model: 'sonnet', system: 'Système', maxTurns: 1 }), [
      ...ISOLATION,
      '--max-turns',
      '1',
      '--model',
      'sonnet',
      '--system-prompt',
      'Système',
    ])
    const schema = { type: 'object' }
    assert.deepEqual(claudeArguments({ model: 'opus', system: 'S', maxTurns: 2, schema }).slice(-2), ['--json-schema', '{"type":"object"}'])
  })

  it('environnement sans clé API, sans trafic non essentiel', () => {
    const env = claudeEnvironment({ PATH: '/usr/bin', HOME: '/home/moi', ANTHROPIC_API_KEY: 'sk-ant-secret' })
    assert.deepEqual(env, { PATH: '/usr/bin', HOME: '/home/moi', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' })
  })

  it('met le prompt système à part et la conversation sur l’entrée standard', () => {
    assert.deepEqual(
      formatConversation([
        { role: 'system', content: 'Tu découpes.' },
        { role: 'user', content: 'STORY 1.1' },
      ]),
      { system: 'Tu découpes.', prompt: 'STORY 1.1' },
    )
    const many = formatConversation([
      { role: 'user', content: 'Bonjour' },
      { role: 'assistant', content: 'Oui ?' },
      { role: 'user', content: 'Découpe' },
    ])
    assert.match(many.system, /Atelier Projets/)
    assert.match(many.prompt, /Utilisateur : Bonjour\n\nAssistant : Oui \?\n\nUtilisateur : Découpe/)
    assert.equal(parseResult(`log\n${result({ result: 'ok' })}\n`)?.result, 'ok')
    assert.equal(parseResult('pas du JSON'), null)
  })

  it('sortie structurée : --json-schema, deux tours, dossier vide, environnement nettoyé', async () => {
    const executable = await fakeCli('structured', 'exit 0')
    const { runner, calls } = scriptedRunner([{ stdout: result({ result: '', structured_output: { items: [{ type: 'TASK', title: 'A', description: '', estimateDays: 1 }] } }) }])
    const engine = createClaudeEngine({ command: executable, runner, env: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant-secret' } })
    const request: ClaudeRequest = {
      model: 'opus',
      messages: [
        { role: 'system', content: 'Tu es chef de projet.' },
        { role: 'user', content: 'STORY 1.1 : Auth' },
      ],
    }
    const answer = await engine.chatJson({ ...request, schema: BREAKDOWN_FORMAT })
    assert.deepEqual(JSON.parse(answer), { items: [{ type: 'TASK', title: 'A', description: '', estimateDays: 1 }] })
    const [first] = calls
    assert.equal(first?.executable, executable)
    assert.deepEqual(first?.args, [
      ...ISOLATION,
      '--max-turns',
      '2',
      '--model',
      'opus',
      '--system-prompt',
      'Tu es chef de projet.',
      '--json-schema',
      JSON.stringify(BREAKDOWN_FORMAT),
    ])
    assert.equal(first?.options.input, 'STORY 1.1 : Auth', 'la conversation passe par l’entrée standard')
    assert.deepEqual(first?.cwdEntries, [], 'dossier de travail vide')
    assert.match(path.basename(first?.options.cwd ?? ''), /^atelier-projets-claude-/)
    await assert.rejects(readdir(first?.options.cwd ?? ''), 'dossier temporaire supprimé après l’appel')
    assert.equal(first?.options.env.ANTHROPIC_API_KEY, undefined)
    assert.equal(first?.options.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1')
    assert.equal(first?.options.timeoutMs, 180_000)
  })

  it('réponse texte (un tour), erreurs renvoyées par Claude et réponses illisibles', async () => {
    const executable = await fakeCli('text', 'exit 0')
    const { runner, calls } = scriptedRunner([
      { stdout: result({ result: 'Ajout du parseur.' }) },
      { stdout: result({ is_error: true, result: 'Overloaded' }), code: 1 },
      { stdout: result({ is_error: true, result: 'Invalid API key · Please run /login' }), code: 1 },
      { stdout: '', stderr: "error: unknown option '--safe-mode'", code: 1 },
    ])
    const engine = createClaudeEngine({ command: executable, runner, timeoutMs: 5000 })
    const ask: ClaudeRequest = { model: 'haiku', messages: [{ role: 'user', content: 'Résume' }] }
    assert.equal(await engine.chat(ask), 'Ajout du parseur.')
    assert.equal(calls[0]?.args[calls[0].args.indexOf('--max-turns') + 1], '1')
    assert.equal(calls[0]?.args.includes('--json-schema'), false)
    assert.equal(calls[0]?.options.timeoutMs, 5000)
    await assert.rejects(engine.chat(ask), (error) => error instanceof ClaudeError && error.kind === 'failed' && /Overloaded/.test(error.message))
    await assert.rejects(engine.chat(ask), (error) => error instanceof ClaudeError && error.kind === 'auth' && /claude auth login/.test(error.message))
    await assert.rejects(engine.chat(ask), (error) => error instanceof ClaudeError && error.kind === 'failed' && /claude update/.test(error.message))
  })

  it('CLI absente : indisponible, et tout appel est refusé', async () => {
    const engine = createClaudeEngine({ command: 'claude', searchPath: '/nonexistent', fallbackDirs: [] })
    const status = await engine.status()
    assert.equal(status.installed, false)
    assert.equal(status.available, false)
    assert.match(status.error ?? '', /introuvable/)
    await assert.rejects(engine.chat({ model: 'sonnet', messages: [{ role: 'user', content: '?' }] }), (error) => error instanceof ClaudeError && error.kind === 'missing')
  })

  it('cherche la CLI dans CLAUDE_CLI, le PATH puis ~/.local/bin, /opt/homebrew/bin, /usr/local/bin', async () => {
    const home = path.join(dir, 'home')
    await mkdir(path.join(home, '.local', 'bin'), { recursive: true })
    await writeFile(path.join(home, '.local', 'bin', 'claude'), '#!/bin/sh\n')
    await chmod(path.join(home, '.local', 'bin', 'claude'), 0o755)
    const fallback = [path.join(home, '.local', 'bin'), '/nonexistent/homebrew']
    assert.equal(await findClaudeExecutable('claude', '/nonexistent', fallback), path.join(home, '.local', 'bin', 'claude'))
    assert.equal(await findClaudeExecutable('claude', '/nonexistent', []), null)
    assert.equal(await findClaudeExecutable('/nonexistent/claude', '/nonexistent', fallback), null, 'chemin explicite : pas de repli')
  })

  it('connexion : « claude auth status » en cache 60 s, non connectée, clé API signalée', async () => {
    const executable = await fakeCli('auth', 'exit 0')
    let clock = 1_000_000
    const { runner, calls } = scriptedRunner([
      LOGGED_IN,
      { stdout: JSON.stringify({ loggedIn: false }) },
      { stdout: JSON.stringify({ loggedIn: true, authMethod: 'api_key' }) },
      { stdout: 'Usage: claude [options]' },
    ])
    const engine = createClaudeEngine({ command: executable, runner, now: () => clock })
    const first = await engine.status()
    assert.deepEqual(
      { ...first, checkedAt: undefined },
      { installed: true, executable, loggedIn: true, authMethod: 'claude.ai', available: true, error: null, warning: null, checkedAt: undefined },
    )
    assert.deepEqual(calls[0]?.args, ['auth', 'status'])
    assert.equal(calls[0]?.options.input, null)
    clock += CLAUDE_STATUS_TTL_MS - 1
    assert.equal(await engine.status(), first, 'en cache')
    assert.equal(calls.length, 1)
    clock += 1
    const loggedOut = await engine.status()
    assert.equal(loggedOut.available, false)
    assert.match(loggedOut.error ?? '', /claude auth login/)
    const apiKey = await engine.status({ refresh: true })
    assert.equal(apiKey.available, true)
    assert.match(apiKey.warning ?? '', /clé API/)
    const unreadable = await engine.status({ refresh: true })
    assert.equal(unreadable.available, false)
    assert.match(unreadable.error ?? '', /claude update/)
  })

  it('vraie CLI simulée : entrée standard, arguments et environnement reçus ; délai dépassé et annulation', async () => {
    // La fausse CLI renvoie ce qu'elle a reçu : la conversation (entrée standard), ses arguments, sa clé API éventuelle.
    const executable = await fakeCli(
      'echo',
      [
        'if [ "$1" = "auth" ]; then echo \'{"loggedIn":true,"authMethod":"claude.ai"}\'; exit 0; fi',
        'input=$(cat)',
        'if [ "$input" = "lent" ]; then exec sleep 5; fi',
        'printf \'{"type":"result","is_error":false,"result":"%s|%s|%s|%s"}\' "$input" "${ANTHROPIC_API_KEY:-sans-cle}" "$CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC" "$(pwd | grep -c atelier-projets-claude-)"',
      ].join('\n'),
    )
    const engine = createClaudeEngine({ command: executable, timeoutMs: 400, env: { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-secret' } })
    assert.equal((await engine.status()).available, true)
    assert.equal(await engine.chat({ model: 'sonnet', messages: [{ role: 'user', content: 'bonjour' }] }), 'bonjour|sans-cle|1|1')

    const started = Date.now()
    await assert.rejects(
      engine.chat({ model: 'sonnet', messages: [{ role: 'user', content: 'lent' }] }),
      (error) => error instanceof ClaudeError && error.kind === 'timeout' && /CLAUDE_TIMEOUT_MS/.test(error.message),
    )
    assert.ok(Date.now() - started < 3000)

    const slow = createClaudeEngine({ command: executable, timeoutMs: 10_000 })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    await assert.rejects(
      slow.chat({ model: 'sonnet', messages: [{ role: 'user', content: 'lent' }], signal: controller.signal }),
      (error) => error instanceof ClaudeError && error.kind === 'cancelled',
    )
  })
})

// --- Réglage hors ligne / en ligne et choix du moteur (routes) ------------------------------------------

class FakeOllama implements OllamaClient {
  readonly baseUrl = 'http://localhost:11434'
  models: OllamaModel[] = [{ name: 'qwen2.5-coder:latest', size: 1, parameterSize: '7.6B', family: 'qwen2' }]
  replies: string[] = []
  requests: ChatRequest[] = []
  async listModels() {
    return this.models
  }
  async chat(request: ChatRequest) {
    this.requests.push(request)
    return this.replies.shift() ?? ''
  }
}

class FakeClaudeEngine implements ClaudeEngine {
  readonly timeoutMs = 180_000
  state: ClaudeEngineStatus = {
    installed: true,
    executable: '/Users/moi/.local/bin/claude',
    loggedIn: true,
    authMethod: 'claude.ai',
    available: true,
    error: null,
    warning: null,
    checkedAt: '2026-10-20T10:00:00.000Z',
  }
  statusCalls = 0
  replies: (string | Error)[] = []
  requests: (ClaudeRequest & { schema?: Record<string, unknown> })[] = []
  async status() {
    this.statusCalls += 1
    return this.state
  }
  private async answer(request: ClaudeRequest & { schema?: Record<string, unknown> }) {
    this.requests.push(request)
    const reply = this.replies.shift() ?? ''
    if (reply instanceof Error) throw reply
    return reply
  }
  chat(request: ClaudeRequest) {
    return this.answer(request)
  }
  chatJson(request: ClaudeRequest & { schema: Record<string, unknown> }) {
    return this.answer(request)
  }
}

class FakeLauncher implements ClaudeLauncher {
  async status(): Promise<ClaudeCliStatus> {
    return { available: true, version: '2.1.303 (Claude Code)', command: '/Users/moi/.local/bin/claude', canOpenTerminal: true, terminalApp: 'Terminal', error: null }
  }
  async prepare() {
    return { command: 'claude', promptFile: null }
  }
  async launch() {
    return { command: 'claude', promptFile: null, launched: true }
  }
}

const BREAKDOWN_REPLY = JSON.stringify({ items: [{ type: 'FEATURE', title: 'Mot de passe oublié', description: '- [ ] Lien par courriel', estimateDays: 1 }] })

describe('mode en ligne et choix du moteur', () => {
  const ollama = new FakeOllama()
  const claudeEngine = new FakeClaudeEngine()
  let ctx: TestContext
  let repo: TestRepo
  let storyId = 0
  const api = <T = any>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => call<T>(ctx.app, method, url, payload)
  const setOnline = (onlineMode: boolean) => api('PATCH', '/api/settings', { onlineMode })

  before(async () => {
    ctx = await createTestContext({ seed: true, ai: { ollama, claudeEngine, claude: new FakeLauncher(), model: 'qwen2.5-coder', maxDiffChars: 4000 } })
    repo = await createTestRepo()
    const tree = (await api('GET', `/api/projects/${ctx.demoProjectId}/tree`)).body
    for (const phase of tree.phases) for (const epic of phase.epics) for (const story of epic.stories) if (story.title === 'Auth') storyId = story.id
  })
  after(async () => {
    await ctx.close()
    await repo.close()
  })
  beforeEach(async () => {
    claudeEngine.state = { ...claudeEngine.state, available: true, loggedIn: true, error: null }
    await setOnline(false)
  })

  it('réglage : hors ligne par défaut, mémorisé dans la base, champs inconnus refusés', async () => {
    assert.deepEqual((await api('GET', '/api/settings')).body, { onlineMode: false })
    assert.deepEqual((await setOnline(true)).body, { onlineMode: true })
    assert.deepEqual((await api('GET', '/api/settings')).body, { onlineMode: true })
    assert.equal((await ctx.prisma.appSetting.findUnique({ where: { key: 'onlineMode' } }))?.value, 'true')
    assert.equal((await api('PATCH', '/api/settings', { onlineMode: 'oui' })).status, 400)
    assert.equal((await api('PATCH', '/api/settings', { autre: 1 })).status, 400)
    assert.deepEqual((await api('PATCH', '/api/settings', {})).body, { onlineMode: true })
  })

  it('état : hors ligne, Claude n’est pas sollicité et Auto retient Ollama', async () => {
    const calls = claudeEngine.statusCalls
    const { body } = await api('GET', '/api/ai/status')
    assert.equal(claudeEngine.statusCalls, calls, '« claude auth status » non lancé hors ligne')
    assert.equal(body.onlineMode, false)
    assert.equal(body.auto, 'ollama')
    assert.equal(body.maxDiffChars, 4000)
    assert.equal(body.claude.available, false)
    assert.equal(body.claude.installed, true)
    assert.equal(body.claude.loggedIn, null)
    assert.equal(body.claude.error, 'Désactivé : mode hors ligne')
    assert.deepEqual(body.claude.models, ['sonnet', 'opus', 'haiku'])
    assert.equal(body.claude.defaultModel, 'sonnet')
    assert.equal(body.claude.version, '2.1.303 (Claude Code)')
    assert.equal(body.claude.canOpenTerminal, true, 'la session dans le Terminal reste proposée')

    await setOnline(true)
    const online = (await api('GET', '/api/ai/status?refresh=true')).body
    assert.equal(online.onlineMode, true)
    assert.equal(online.auto, 'claude')
    assert.equal(online.claude.available, true)
    assert.equal(online.claude.loggedIn, true)
    assert.equal(online.claude.command, '/Users/moi/.local/bin/claude')
  })

  it('hors ligne : Claude demandé explicitement → 403, rien n’est envoyé ; Auto → Ollama', async () => {
    const sent = claudeEngine.requests.length
    const refused = await api('POST', '/api/ai/breakdown-story', { storyId, engine: 'claude' })
    assert.equal(refused.status, 403)
    assert.equal(refused.body.code, 'CLAUDE_OFFLINE')
    assert.match(refused.body.message, /Mode hors ligne/)
    assert.equal(claudeEngine.requests.length, sent)

    ollama.replies.push(BREAKDOWN_REPLY)
    const auto = await api('POST', '/api/ai/breakdown-story', { storyId, engine: 'auto', claudeModel: 'opus' })
    assert.equal(auto.status, 200)
    assert.equal(auto.body.engine, 'ollama')
    assert.equal(auto.body.model, 'qwen2.5-coder:latest')
    assert.equal(claudeEngine.requests.length, sent)
  })

  it('en ligne : Auto et Claude passent par Claude (schéma de sortie, modèle choisi) ; Ollama reste au choix', async () => {
    await setOnline(true)
    claudeEngine.replies.push(BREAKDOWN_REPLY)
    const auto = await api('POST', '/api/ai/breakdown-story', { storyId, instructions: 'Rester simple' })
    assert.equal(auto.status, 200)
    assert.equal(auto.body.engine, 'claude')
    assert.equal(auto.body.model, 'sonnet')
    assert.deepEqual(auto.body.items, [{ type: 'FEATURE', title: 'Mot de passe oublié', description: '- [ ] Lien par courriel', estimate: { hours: 8, days: 1 } }])
    const request = claudeEngine.requests.at(-1)
    assert.deepEqual(request?.schema, BREAKDOWN_FORMAT, 'même schéma de sortie qu’avec Ollama')
    assert.equal(request?.model, 'sonnet')
    const prompt = request?.messages.map((message) => message.content).join('\n') ?? ''
    for (const expected of ['STORY 1.1 : Auth', 'Rester simple']) assert.ok(prompt.includes(expected), expected)

    claudeEngine.replies.push(BREAKDOWN_REPLY)
    const explicit = await api('POST', '/api/ai/breakdown-story', { storyId, engine: 'claude', claudeModel: 'opus' })
    assert.equal(explicit.body.engine, 'claude')
    assert.equal(explicit.body.model, 'opus')
    assert.equal(claudeEngine.requests.at(-1)?.model, 'opus')

    const sent = claudeEngine.requests.length
    ollama.replies.push(BREAKDOWN_REPLY)
    const local = await api('POST', '/api/ai/breakdown-story', { storyId, engine: 'ollama', model: 'qwen2.5-coder' })
    assert.equal(local.body.engine, 'ollama')
    assert.equal(claudeEngine.requests.length, sent)

    claudeEngine.replies.push('{"items":[]}')
    const invalid = await api('POST', '/api/ai/breakdown-story', { storyId, engine: 'claude' })
    assert.equal(invalid.status, 502)
    assert.equal(invalid.body.code, 'AI_INVALID_RESPONSE')
    assert.match(invalid.body.message, /Claude, modèle « sonnet »/)
    assert.equal((await api('POST', '/api/ai/breakdown-story', { storyId, engine: 'gpt' })).status, 400)
    assert.equal((await api('POST', '/api/ai/breakdown-story', { storyId, claudeModel: 'claude-3' })).status, 400)
  })

  it('en ligne mais Claude indisponible : Auto → Ollama, Claude explicite → 502 avec la raison', async () => {
    await setOnline(true)
    claudeEngine.state = { ...claudeEngine.state, available: false, loggedIn: false, error: 'Claude CLI non connectée : lancer « claude auth login » dans un terminal' }
    ollama.replies.push(BREAKDOWN_REPLY)
    assert.equal((await api('POST', '/api/ai/breakdown-story', { storyId })).body.engine, 'ollama')
    const refused = await api('POST', '/api/ai/breakdown-story', { storyId, engine: 'claude' })
    assert.equal(refused.status, 502)
    assert.equal(refused.body.code, 'CLAUDE_UNAVAILABLE')
    assert.match(refused.body.message, /claude auth login/)
    assert.equal((await api('GET', '/api/ai/status')).body.auto, 'ollama')
  })

  it('erreurs de Claude : délai dépassé → 504, CLI absente ou déconnectée → 502', async () => {
    await setOnline(true)
    claudeEngine.replies.push(new ClaudeError('timeout', 'Claude n’a pas répondu en 180 s (CLAUDE_TIMEOUT_MS)'))
    const timeout = await api('POST', '/api/ai/breakdown-story', { storyId, engine: 'claude' })
    assert.equal(timeout.status, 504)
    assert.equal(timeout.body.code, 'AI_TIMEOUT')
    claudeEngine.replies.push(new ClaudeError('auth', 'Claude CLI non connectée'))
    assert.equal((await api('POST', '/api/ai/breakdown-story', { storyId, engine: 'claude' })).body.code, 'CLAUDE_UNAVAILABLE')
    claudeEngine.replies.push(new ClaudeError('failed', 'Erreur de Claude : Overloaded'))
    assert.equal((await api('POST', '/api/ai/breakdown-story', { storyId, engine: 'claude' })).body.code, 'AI_ERROR')
  })

  it('journal d’avancement par Claude : texte, messages et diffs des commits liés', async () => {
    const project = (await api('POST', '/api/projects', { name: 'Journal Claude', localRepoPath: repo.dir })).body
    const phase = (await api('POST', `/api/projects/${project.id}/phases`, { title: 'P' })).body
    const epic = (await api('POST', `/api/phases/${phase.id}/epics`, { title: 'E' })).body
    const story = (await api('POST', `/api/epics/${epic.id}/stories`, { title: 'S' })).body
    const item = (await api('POST', `/api/stories/${story.id}/work-items`, { type: 'TASK', title: 'Cache HTTP' })).body
    await writeFile(path.join(repo.dir, 'cache.ts'), 'export const TTL = 60\n')
    await repo.git.add('cache.ts')
    await repo.git.commit(`feat(cache): durée de vie task #${item.id}`)
    await api('POST', `/api/projects/${project.id}/git/scan`)

    const offline = await api('POST', '/api/ai/summarize-commits', { workItemId: item.id, engine: 'claude' })
    assert.equal(offline.status, 403)

    await setOnline(true)
    claudeEngine.replies.push('```markdown\nAjout de `TTL` dans cache.ts.\n```')
    const { status, body } = await api('POST', '/api/ai/summarize-commits', { workItemId: item.id, engine: 'claude', claudeModel: 'haiku' })
    assert.equal(status, 200)
    assert.deepEqual([body.engine, body.model, body.text], ['claude', 'haiku', 'Ajout de `TTL` dans cache.ts.'])
    const request = claudeEngine.requests.at(-1)
    assert.equal(request?.schema, undefined, 'réponse texte')
    const prompt = request?.messages.map((message) => message.content).join('\n') ?? ''
    assert.ok(prompt.includes('export const TTL = 60'), 'le diff est transmis')
    assert.ok(prompt.includes(`TASK #${item.id} — Cache HTTP`))
  })
})
