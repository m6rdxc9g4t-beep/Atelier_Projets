// Mode jeton du moteur Claude (docs/SUITE.md §5.3, décision de l'utilisateur : « je veux que Claude forfait cli soit
// actif car c'est personnel ça sera mon forfait Claude ») : jeton du forfait lu une fois puis retiré de
// l'environnement, transmis à la CLI isolée seule (mêmes drapeaux), dossier privé, jamais dans un argument, une
// réponse ou une erreur ; hors ligne, la CLI n'est pas lancée ; sans jeton, rien ne change. Exécutant simulé.
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { inspect } from 'node:util'
import { after, before, describe, it } from 'node:test'
import type { ClaudeCliStatus, ClaudeLauncher } from '../src/ai-bridge/claude-cli.ts'
import {
  ClaudeError,
  createClaudeEngine,
  TOKEN_NO_CLI_MESSAGE,
  TOKEN_REFUSED_MESSAGE,
  type ClaudeRequest,
  type ClaudeRunner,
  type RunOptions,
} from '../src/ai-bridge/claude-print.ts'
import { captureClaudeToken, ClaudeToken, claudePrivateHome, scrubToken, TOKEN_MASK } from '../src/ai-bridge/claude-token.ts'
import type { OllamaClient } from '../src/ai-bridge/ollama.ts'
import { call, createTestContext, type TestContext } from './helpers/test-app.ts'

const ISOLATION = ['-p', '--safe-mode', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']
const SECRET = 'sk-ant-oat01-JETON-DU-FORFAIT-0123456789abcdef'
const API_KEY = 'sk-ant-api03-CLE-API-NE-PAS-TRANSMETTRE-0123456789'
const posixOnly = { skip: process.platform === 'win32' && 'scripts shell et droits POSIX : macOS / Linux' }

let dir = ''
let executable = ''
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'atelier-claude-token-'))
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  executable = path.join(bin, 'claude')
  await writeFile(executable, '#!/bin/sh\nexit 0\n')
  await chmod(executable, 0o755)
})
after(() => rm(dir, { recursive: true, force: true }))

interface RunnerCall {
  executable: string
  args: readonly string[]
  options: RunOptions
}

function scriptedRunner(replies: { stdout: string; code?: number; stderr?: string }[]) {
  const calls: RunnerCall[] = []
  const runner: ClaudeRunner = async (exe, args, options) => {
    calls.push({ executable: exe, args, options })
    const reply = replies.shift() ?? { stdout: '' }
    return { code: reply.code ?? 0, stdout: reply.stdout, stderr: reply.stderr ?? '' }
  }
  return { runner, calls }
}

const result = (fields: Record<string, unknown>) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, ...fields })
const ask: ClaudeRequest = { model: 'sonnet', messages: [{ role: 'system', content: 'Consignes.' }, { role: 'user', content: 'Données de la story' }] }
const baseEnv = () => ({ PATH: '/usr/bin', HOME: '/home/moi', CLAUDE_CONFIG_DIR: '/home/moi/.claude', ANTHROPIC_API_KEY: API_KEY, GITHUB_TOKEN: 'ghp' })

describe('jeton du forfait : lecture unique', () => {
  it('lu puis retiré de l’environnement (toutes les casses), vide = absent', () => {
    const env: NodeJS.ProcessEnv = { CLAUDE_OAUTH_TOKEN: `  ${SECRET} `, claude_oauth_token: 'autre', PATH: '/usr/bin' }
    const token = captureClaudeToken(env)
    assert.equal(token?.reveal(), SECRET)
    assert.deepEqual(env, { PATH: '/usr/bin' }, 'plus aucun sous-processus n’en hérite')
    assert.equal(captureClaudeToken(env), null, 'une seule lecture')
    assert.equal(captureClaudeToken({ CLAUDE_OAUTH_TOKEN: '   ' }), null)
    assert.equal(captureClaudeToken({}), null)
  })

  it('jamais montré : ni String(), ni JSON, ni inspection ; masqué dans tout texte', () => {
    const token = new ClaudeToken(SECRET)
    for (const shown of [String(token), `${token}`, JSON.stringify({ token }), inspect(token), inspect({ token })]) {
      assert.ok(!shown.includes(SECRET), shown)
    }
    assert.equal(scrubToken(`Erreur ${SECRET} !`, token), `Erreur ${TOKEN_MASK} !`)
    assert.equal(scrubToken(`clé ${API_KEY}`), `clé ${TOKEN_MASK}`, 'toute forme de jeton d’Anthropic est masquée')
    assert.equal(claudePrivateHome('/data'), path.resolve('/data', 'claude-forfait'))
  })
})

describe('moteur Claude en mode jeton', () => {
  it('disponible sans « claude auth status » : exécutable + jeton ; l’état dit le mode, jamais le jeton', async () => {
    const { runner, calls } = scriptedRunner([])
    const engine = createClaudeEngine({ command: executable, runner, env: baseEnv(), token: new ClaudeToken(SECRET), privateHome: path.join(dir, 'home-a') })
    const status = await engine.status()
    assert.equal(calls.length, 0, 'aucun lancement de la CLI pour l’état')
    assert.equal(engine.access, 'token')
    assert.equal(status.access, 'token')
    assert.equal(status.available, true)
    assert.equal(status.installed, true)
    assert.equal(status.loggedIn, null)
    assert.equal(status.error, null)
    assert.ok(!JSON.stringify(status).includes(SECRET))
  })

  it('mêmes drapeaux, données sur l’entrée standard ; jeton et dossier privé dans l’environnement de la CLI seulement', posixOnly, async () => {
    const home = path.join(dir, 'home-b')
    const { runner, calls } = scriptedRunner([{ stdout: result({ result: 'Réponse.' }) }])
    const engine = createClaudeEngine({ command: executable, runner, env: baseEnv(), token: new ClaudeToken(SECRET), privateHome: home })
    assert.equal(await engine.chat(ask), 'Réponse.')
    const [first] = calls
    assert.deepEqual(first?.args, [...ISOLATION, '--max-turns', '1', '--model', 'sonnet', '--system-prompt', 'Consignes.'])
    assert.ok(!first?.args.some((arg) => arg.includes(SECRET)), 'jamais en argument')
    assert.equal(first?.options.input, 'Données de la story')
    const env = first?.options.env ?? {}
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, SECRET)
    assert.equal(env.HOME, home, 'aucune session d’utilisateur lue')
    assert.equal(env.CLAUDE_CONFIG_DIR, path.join(home, '.claude'))
    assert.equal(env.ANTHROPIC_API_KEY, undefined, 'la clé API du processus n’est jamais transmise')
    assert.equal(env.GITHUB_TOKEN, undefined)
    assert.equal(env.CLAUDE_OAUTH_TOKEN, undefined)
    assert.deepEqual(
      Object.keys(env).sort(),
      ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'HOME', 'PATH'],
      'liste blanche §5.3 plus le jeton, rien d’autre',
    )
    assert.notEqual(first?.options.cwd, home, 'dossier de travail : temporaire et vide, pas le dossier privé')
    for (const folder of [home, path.join(home, '.claude')]) assert.equal((await stat(folder)).mode & 0o777, 0o700, folder)
    assert.deepEqual(await readdir(path.join(home, '.claude')), [], 'le jeton n’est écrit dans aucun fichier')
  })

  it('sans jeton : rien ne change (session de l’utilisateur, pas de variable de jeton)', async () => {
    const { runner, calls } = scriptedRunner([
      { stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }) },
      { stdout: result({ result: 'ok' }) },
    ])
    const engine = createClaudeEngine({ command: executable, runner, env: baseEnv() })
    assert.equal(engine.access, 'cli')
    const status = await engine.status()
    assert.equal(status.access, 'cli')
    assert.deepEqual(calls[0]?.args, ['auth', 'status'], '« claude auth status » comme avant')
    await engine.chat(ask)
    const env = calls[1]?.options.env ?? {}
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined)
    assert.equal(env.HOME, '/home/moi')
    assert.equal(env.CLAUDE_CONFIG_DIR, '/home/moi/.claude')
    assert.equal(env.ANTHROPIC_API_KEY, undefined)
  })

  it('jeton refusé : message en français, jamais le jeton ; Claude indisponible jusqu’à une revérification', async () => {
    let clock = 1_000_000
    const { runner } = scriptedRunner([
      { stdout: result({ is_error: true, result: `API Error: 401 · Invalid bearer token ${SECRET} · Please run /login` }), code: 1 },
      { stdout: '', stderr: `OAuth token has expired (${SECRET})`, code: 1 },
    ])
    const engine = createClaudeEngine({ command: executable, runner, env: baseEnv(), token: new ClaudeToken(SECRET), privateHome: path.join(dir, 'home-c'), now: () => clock })
    await assert.rejects(engine.chat(ask), (error) => {
      assert.ok(error instanceof ClaudeError)
      assert.equal(error.kind, 'auth')
      assert.equal(error.message, TOKEN_REFUSED_MESSAGE)
      assert.match(error.message, /claude setup-token/)
      return true
    })
    const refused = await engine.status()
    assert.equal(refused.available, false)
    assert.equal(refused.error, TOKEN_REFUSED_MESSAGE)
    clock += 60_000
    assert.equal((await engine.status()).available, false, 'le cache expiré ne suffit pas : il faut revérifier')
    clock += 10_000 // revérification forcée : au plus toutes les 10 s
    assert.equal((await engine.status({ refresh: true })).available, true, '« Revérifier » redonne sa chance au jeton')
    await assert.rejects(engine.chat(ask), (error) => error instanceof ClaudeError && error.kind === 'auth' && !error.message.includes(SECRET))
  })

  it('limite du forfait : message de la CLI repris sans secret', async () => {
    const { runner } = scriptedRunner([{ stdout: result({ is_error: true, result: `Claude AI usage limit reached · resets 15:00 · /login ${SECRET}` }), code: 1 }])
    const engine = createClaudeEngine({ command: executable, runner, env: baseEnv(), token: new ClaudeToken(SECRET), privateHome: path.join(dir, 'home-d') })
    await assert.rejects(engine.chat(ask), (error) => {
      assert.ok(error instanceof ClaudeError)
      assert.equal(error.kind, 'limit')
      assert.match(error.message, /^Limite du forfait Claude atteinte/)
      assert.match(error.message, /usage limit reached · resets 15:00/)
      assert.ok(!error.message.includes(SECRET))
      return true
    })
    assert.equal((await engine.status()).available, true, 'une limite n’éteint pas Claude')
  })

  it('CLI absente de l’image : indisponible, avec la marche à suivre', async () => {
    const engine = createClaudeEngine({ command: 'claude', searchPath: '/nonexistent', fallbackDirs: [], token: new ClaudeToken(SECRET), privateHome: path.join(dir, 'home-e') })
    const status = await engine.status()
    assert.equal(status.available, false)
    assert.equal(status.error, TOKEN_NO_CLI_MESSAGE)
    assert.match(status.error ?? '', /CLAUDE_CLI/)
    await assert.rejects(engine.chat(ask), (error) => error instanceof ClaudeError && error.kind === 'missing' && error.message === TOKEN_NO_CLI_MESSAGE)
  })

  it('jeton sans dossier privé : configuration refusée', () => {
    assert.throws(() => createClaudeEngine({ token: new ClaudeToken(SECRET) }), /privateHome/)
  })
})

// --- Routes : hors ligne, rien n'est lancé ; en ligne, le jeton ne sort jamais -----------------------------

class SilentOllama implements OllamaClient {
  readonly baseUrl = 'http://localhost:11434'
  async listModels() {
    return [{ name: 'qwen2.5-coder:latest', size: 1, parameterSize: '7.6B', family: 'qwen2' }]
  }
  async chat() {
    return JSON.stringify({ items: [{ type: 'TASK', title: 'Locale', description: '', estimateDays: 1 }] })
  }
}

class NoLauncher implements ClaudeLauncher {
  async status(): Promise<ClaudeCliStatus> {
    return { available: false, version: null, command: 'claude', canOpenTerminal: false, terminalApp: null, error: null }
  }
  async prepare() {
    return { command: 'claude', promptFile: null }
  }
  async launch() {
    return { command: 'claude', promptFile: null, launched: false }
  }
}

describe('routes de l’IA en mode jeton', () => {
  const replies: { stdout: string; code?: number }[] = []
  const { runner, calls } = scriptedRunner(replies)
  let ctx: TestContext
  let storyId = 0
  const api = <T = any>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => call<T>(ctx.app, method, url, payload)

  before(async () => {
    const claudeEngine = createClaudeEngine({ command: executable, runner, env: baseEnv(), token: new ClaudeToken(SECRET), privateHome: path.join(dir, 'home-routes') })
    ctx = await createTestContext({ seed: true, ai: { ollama: new SilentOllama(), claude: new NoLauncher(), claudeEngine, model: 'qwen2.5-coder', maxDiffChars: 4000 } })
    const tree = (await api('GET', `/api/projects/${ctx.demoProjectId}/tree`)).body
    for (const phase of tree.phases) for (const epic of phase.epics) for (const story of epic.stories) if (story.title === 'Auth') storyId = story.id
  })
  after(() => ctx.close())

  it('hors ligne : refus 403 et la CLI n’est même pas lancée ; l’état dit le mode jeton', async () => {
    const status = await api('GET', '/api/ai/status')
    assert.equal(status.body.claude.access, 'token')
    assert.equal(status.body.claude.available, false)
    assert.equal(status.body.auto, 'ollama')
    const refused = await api('POST', '/api/ai/breakdown-story', { storyId, engine: 'claude' })
    assert.equal(refused.status, 403)
    assert.equal(refused.body.code, 'CLAUDE_OFFLINE')
    assert.equal((await api('POST', '/api/ai/breakdown-story', { storyId })).body.engine, 'ollama')
    assert.equal(calls.length, 0, 'aucun lancement hors ligne')
  })

  it('en ligne : Claude par le jeton ; jamais le jeton dans une réponse, même d’erreur', async () => {
    await api('PATCH', '/api/settings', { onlineMode: true })
    const status = await api('GET', '/api/ai/status')
    assert.equal(status.body.claude.access, 'token')
    assert.equal(status.body.claude.available, true)
    assert.equal(status.body.auto, 'claude')
    assert.equal(calls.length, 0, 'l’état ne lance pas la CLI')

    replies.push({ stdout: result({ structured_output: { items: [{ type: 'TASK', title: 'Par Claude', description: '', estimateDays: 1 }] } }) })
    const answer = await api('POST', '/api/ai/breakdown-story', { storyId, engine: 'claude' })
    assert.equal(answer.status, 200)
    assert.equal(answer.body.engine, 'claude')
    assert.equal(calls.at(-1)?.options.env.CLAUDE_CODE_OAUTH_TOKEN, SECRET)

    replies.push({ stdout: result({ is_error: true, result: `Rate limit: weekly limit reached ${SECRET}` }), code: 1 })
    const limit = await api('POST', '/api/ai/breakdown-story', { storyId, engine: 'claude' })
    assert.equal(limit.status, 429)
    assert.equal(limit.body.code, 'CLAUDE_LIMIT')

    replies.push({ stdout: result({ is_error: true, result: `Invalid API key ${SECRET}` }), code: 1 })
    const refused = await api('POST', '/api/ai/breakdown-story', { storyId, engine: 'claude' })
    assert.equal(refused.status, 502)
    assert.equal(refused.body.code, 'CLAUDE_UNAVAILABLE')
    assert.match(refused.body.message, /claude setup-token/)
    const after = await api('GET', '/api/ai/status')
    assert.equal(after.body.claude.available, false)
    assert.equal(after.body.auto, 'ollama', 'jeton refusé : Auto passe par Ollama')

    for (const body of [status.body, answer.body, limit.body, refused.body, after.body]) assert.ok(!JSON.stringify(body).includes(SECRET))
  })
})
