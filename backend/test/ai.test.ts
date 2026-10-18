// Tests de l'ai-bridge : client Ollama face à un faux serveur HTTP local, lecture des réponses du modèle,
// routes IA avec un Ollama simulé, diffs d'un vrai dépôt Git temporaire, lanceur de Claude CLI simulé.
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  createClaudeLauncher,
  findExecutable,
  sessionPath,
  shellQuote,
  type ClaudeCliStatus,
  type ClaudeLauncher,
  type ClaudeSessionRequest,
} from '../src/ai-bridge/claude-cli.ts'
import { createOllamaClient, findInstalledModel, OllamaError, type ChatRequest, type OllamaClient, type OllamaModel } from '../src/ai-bridge/ollama.ts'
import { buildBreakdownMessages, buildClaudePrompt, cleanSummary, parseBreakdown } from '../src/ai-bridge/prompts.ts'
import { createTestRepo, type TestRepo } from './helpers/git-repo.ts'
import { call, createTestContext, type TestContext } from './helpers/test-app.ts'

// --- Faux serveur Ollama (HTTP) pour le client réel ----------------------------------------------------

async function readBody(request: IncomingMessage): Promise<string> {
  let body = ''
  for await (const chunk of request) body += chunk
  return body
}

describe('client Ollama (faux serveur local)', () => {
  let server: Server
  let baseUrl = ''
  const received: { path: string; body: unknown }[] = []
  let chatReply: { status: number; body: unknown; delayMs?: number; lines?: unknown[] } = { status: 200, body: { message: { content: 'ok' } } }

  before(async () => {
    server = createServer(async (request, response) => {
      const body = await readBody(request)
      received.push({ path: request.url ?? '', body: body === '' ? null : JSON.parse(body) })
      if (request.url === '/api/tags') {
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            models: [
              { name: 'qwen2.5-coder:latest', size: 4_683_087_332, details: { parameter_size: '7.6B', family: 'qwen2' } },
              { name: 'gemma3:4b', size: 3_338_801_804, details: { parameter_size: '4.3B', family: 'gemma3' } },
            ],
          }),
        )
        return
      }
      const reply = chatReply
      if (reply.lines) {
        // Flux NDJSON, un morceau toutes les 20 ms, comme Ollama avec stream: true.
        response.setHeader('content-type', 'application/x-ndjson')
        const lines = [...reply.lines]
        const next = () => {
          const line = lines.shift()
          if (line === undefined) return response.end()
          response.write(`${JSON.stringify(line)}\n`)
          setTimeout(next, 20)
        }
        return next()
      }
      setTimeout(() => {
        response.statusCode = reply.status
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(reply.body))
      }, reply.delayMs ?? 0)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })
  after(() => new Promise<void>((resolve) => server.close(() => resolve())))

  it('liste les modèles installés et reconnaît « qwen2.5-coder » sans étiquette', async () => {
    const client = createOllamaClient({ baseUrl: `${baseUrl}/`, timeoutMs: 2000 })
    const models = await client.listModels()
    assert.deepEqual(
      models.map((model) => [model.name, model.parameterSize]),
      [
        ['gemma3:4b', '4.3B'],
        ['qwen2.5-coder:latest', '7.6B'],
      ],
    )
    assert.equal(findInstalledModel(models, 'qwen2.5-coder')?.name, 'qwen2.5-coder:latest')
    assert.equal(findInstalledModel(models, 'gemma3')?.name, 'gemma3:4b', 'seule étiquette installée')
    assert.equal(findInstalledModel(models, 'gemma3:4b')?.name, 'gemma3:4b')
    assert.equal(findInstalledModel(models, 'gemma3:12b'), undefined)
    const two = [...models, { name: 'gemma3:12b', size: 0, parameterSize: null, family: null }]
    assert.equal(findInstalledModel(two, 'gemma3'), undefined, 'ambigu : deux étiquettes')
  })

  it('envoie la conversation en flux, avec le schéma de réponse', async () => {
    const client = createOllamaClient({ baseUrl, timeoutMs: 2000 })
    chatReply = { status: 200, body: { message: { role: 'assistant', content: '{"items":[]}' } } }
    const answer = await client.chat({ model: 'gemma3', messages: [{ role: 'user', content: 'Bonjour' }], format: { type: 'object' } })
    assert.equal(answer, '{"items":[]}')
    const last = received.at(-1)
    assert.equal(last?.path, '/api/chat')
    assert.deepEqual(last?.body, {
      model: 'gemma3',
      messages: [{ role: 'user', content: 'Bonjour' }],
      stream: true,
      format: { type: 'object' },
      options: { temperature: 0.2, num_ctx: 16_384 },
    })
  })

  it('assemble la réponse lue en flux et signale une erreur en cours de génération', async () => {
    const client = createOllamaClient({ baseUrl, timeoutMs: 2000 })
    chatReply = { status: 200, body: null, lines: [{ message: { content: 'Ajout ' } }, { message: { content: 'du parseur' } }, { message: { content: '.' }, done: true }] }
    assert.equal(await client.chat({ model: 'gemma3', messages: [{ role: 'user', content: '?' }] }), 'Ajout du parseur.')
    chatReply = { status: 200, body: null, lines: [{ message: { content: 'début' } }, { error: 'model runner crashed' }] }
    await assert.rejects(
      client.chat({ model: 'gemma3', messages: [{ role: 'user', content: '?' }] }),
      (error) => error instanceof OllamaError && error.kind === 'failed' && /model runner crashed/.test(error.message),
    )
  })

  it('interrompt la génération quand l’appelant abandonne', async () => {
    const client = createOllamaClient({ baseUrl, timeoutMs: 5000 })
    chatReply = { status: 200, body: { message: { content: 'tard' } }, delayMs: 1500 }
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    const started = Date.now()
    await assert.rejects(
      client.chat({ model: 'gemma3', messages: [{ role: 'user', content: '?' }], signal: controller.signal }),
      (error) => error instanceof OllamaError && error.kind === 'cancelled',
    )
    assert.ok(Date.now() - started < 1000)
  })

  it('distingue modèle absent, erreur, délai dépassé et Ollama arrêté', async () => {
    const client = createOllamaClient({ baseUrl, timeoutMs: 300 })
    const chat = () => client.chat({ model: 'llama9', messages: [{ role: 'user', content: '?' }] })

    chatReply = { status: 404, body: { error: "model 'llama9' not found" } }
    await assert.rejects(chat(), (error) => error instanceof OllamaError && error.kind === 'model' && /ollama pull/.test(error.message))
    chatReply = { status: 500, body: { error: 'out of memory' } }
    await assert.rejects(chat(), (error) => error instanceof OllamaError && error.kind === 'failed' && /out of memory/.test(error.message))
    chatReply = { status: 200, body: { message: { content: 'tard' } }, delayMs: 1000 }
    await assert.rejects(chat(), (error) => error instanceof OllamaError && error.kind === 'timeout')

    const stopped = createOllamaClient({ baseUrl: 'http://127.0.0.1:9', timeoutMs: 1000 })
    await assert.rejects(stopped.listModels(), (error) => error instanceof OllamaError && error.kind === 'unreachable' && /ollama serve/.test(error.message))
  })
})

// --- Lecture des réponses et prompts -----------------------------------------------------------------

describe('réponses du modèle et prompts', () => {
  it('lit un découpage JSON, même entouré de texte, et le borne', () => {
    const answer = `Voici ma proposition :\n\`\`\`json\n${JSON.stringify({
      items: [
        { type: 'feature', title: '  Écran   de connexion ', description: '- [ ] Formulaire', estimateDays: 2.1 },
        { type: 'TASK', title: 'Écran de connexion', description: 'doublon', estimateDays: 1 },
        { type: 'BUG', title: 'Hors périmètre', description: '', estimateDays: 1 },
        { type: 'TASK', title: 'Configurer OAuth', estimateDays: '0,1' },
        { type: 'TASK', title: 'Migration géante', description: '', estimateDays: 80 },
        { type: 'TASK', title: '', estimateDays: 1 },
        { type: 'TASK', title: 'Déjà là', estimateDays: 1 },
      ],
    })}\n\`\`\``
    assert.deepEqual(parseBreakdown(answer, ['DÉJÀ LÀ']), [
      { type: 'FEATURE', title: 'Écran de connexion', description: '- [ ] Formulaire', estimateDays: 2 },
      { type: 'TASK', title: 'Configurer OAuth', description: '', estimateDays: 0.25 },
      { type: 'TASK', title: 'Migration géante', description: '', estimateDays: 10 },
    ])
    assert.equal(parseBreakdown('Je ne sais pas.'), null)
    assert.equal(parseBreakdown('{"items":[{"type":"BUG","title":"x","estimateDays":1}]}'), null)
    assert.equal(parseBreakdown(JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ type: 'TASK', title: `T${i}`, estimateDays: 1 }))))?.length, 12)
  })

  it('donne au modèle la story, ses parents, les éléments existants et les consignes', () => {
    const [system, user] = buildBreakdownMessages({
      projectName: 'Boutique',
      hoursPerDay: 7,
      phase: { code: '1', title: 'Socle' },
      epic: { code: '2', title: 'Paiement', description: 'Carte et virement' },
      story: { code: '2.1', title: 'Payer par carte', description: 'En tant que client…' },
      existing: [{ id: 101, type: 'TASK', title: 'Compte Stripe', estimateDays: 0.5 }],
      instructions: 'Pas de 3-D Secure',
    })
    assert.match(system?.content ?? '', /1 jour = 7 heures/)
    for (const expected of ['PHASE 1 : Socle', 'EPIC 2 : Paiement', 'Carte et virement', 'STORY 2.1 : Payer par carte', '#101 TASK « Compte Stripe » (0.5 j)', 'Pas de 3-D Secure']) {
      assert.ok(user?.content.includes(expected), expected)
    }
  })

  it('nettoie le résumé produit', () => {
    assert.equal(cleanSummary('```markdown\n## Journal\n\nAjout du parseur.\n\n\n\nTests verts.\n```'), 'Ajout du parseur.\n\nTests verts.')
    assert.equal(cleanSummary('  Simple.  '), 'Simple.')
  })

  it('prépare le prompt de Claude CLI avec la tâche et la convention de commit', () => {
    const prompt = buildClaudePrompt({
      item: { id: 103, type: 'BUG', title: 'Fix CORS Header', status: 'IN_REVIEW', description: '- [ ] Preflight', implementationLog: '' },
      path: { phase: 'PHASE 1 Socle', epic: 'EPIC 1 Architecture', story: 'STORY 1.1 Auth' },
      commits: [{ shortHash: 'abc1234', message: 'fix: cors bug #103\n\ncorps' }],
    })
    assert.match(prompt, /^Tâche BUG #103 — Fix CORS Header/)
    assert.match(prompt, /PHASE 1 Socle › EPIC 1 Architecture › STORY 1\.1 Auth/)
    assert.match(prompt, /- \[ \] Preflight/)
    assert.match(prompt, /- abc1234 fix: cors bug #103\n/)
    assert.match(prompt, /« fix\(scope\): description #103 »/)
    assert.doesNotMatch(prompt, /Journal d’avancement/)
  })
})

// --- Lanceur de Claude CLI -------------------------------------------------------------------------------

describe('lanceur de Claude CLI', () => {
  let dir = ''
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'atelier-claude-'))
  })
  after(() => rm(dir, { recursive: true, force: true }))

  const request: ClaudeSessionRequest = {
    workItemId: 42,
    cwd: "/Users/françois/dev/l'atelier",
    prompt: '--settings={"hooks":{}} Tâche #42 — « $(rm -rf ~) » `backticks` et "guillemets"',
    permissionMode: 'plan',
  }

  it('cite les arguments shell sans interprétation possible', () => {
    assert.equal(shellQuote("l'atelier"), `'l'\\''atelier'`)
    assert.equal(shellQuote('$(x) `y`'), `'$(x) \`y\`'`)
  })

  it('trouve la CLI dans le PATH et lit sa version', async () => {
    const bin = path.join(dir, 'bin')
    await import('node:fs/promises').then((fs) => fs.mkdir(bin))
    await writeFile(path.join(bin, 'claude'), '#!/bin/sh\necho "2.1.300 (Claude Code)"\n')
    await chmod(path.join(bin, 'claude'), 0o755)
    assert.equal(await findExecutable('claude', `/nonexistent${path.delimiter}${bin}`), path.join(bin, 'claude'))
    assert.equal(await findExecutable('claude', '/nonexistent'), null)

    const found = await createClaudeLauncher({ searchPath: bin, platform: 'darwin' }).status()
    assert.deepEqual(found, {
      available: true,
      version: '2.1.300 (Claude Code)',
      command: path.join(bin, 'claude'),
      canOpenTerminal: true,
      terminalApp: 'Terminal',
      error: null,
    })
    const missing = await createClaudeLauncher({ searchPath: '/nonexistent', platform: 'linux' }).status()
    assert.equal(missing.available, false)
    assert.equal(missing.canOpenTerminal, false)
    assert.match(missing.error ?? '', /introuvable/)
  })

  it('hors macOS : écrit le prompt et renvoie la commande à coller', async () => {
    const launcher = createClaudeLauncher({ searchPath: '/nonexistent', platform: 'linux', workDir: path.join(dir, 'linux') })
    const result = await launcher.launch(request)
    assert.equal(result.launched, false)
    assert.equal(await readFile(result.promptFile ?? '', 'utf8'), `${request.prompt}\n`)
    assert.equal(
      result.command,
      `cd -- '/Users/françois/dev/l'\\''atelier' && 'claude' --permission-mode plan -- "$(cat '${result.promptFile}')"`,
    )
    await assert.rejects(launcher.launch({ ...request, prompt: '   ' }), /prompt vide/)

    // Session sur le projet, sans tâche : Claude interactif sans prompt initial.
    const bare = await launcher.launch({ workItemId: null, cwd: '/repo', prompt: null, permissionMode: 'default' })
    assert.deepEqual(bare, { command: `cd -- '/repo' && 'claude'`, promptFile: null, launched: false })
  })

  it('« -- » : un prompt qui commence par un tiret reste un prompt pour la vraie CLI', async () => {
    // Fausse CLI qui affiche ses arguments : le prompt arrive après « -- », jamais comme option.
    const bin = path.join(dir, 'args-bin')
    await import('node:fs/promises').then((fs) => fs.mkdir(bin))
    await writeFile(path.join(bin, 'claude'), '#!/bin/sh\nfor a in "$@"; do printf "[%s]\\n" "$a"; done\n')
    await chmod(path.join(bin, 'claude'), 0o755)
    const launcher = createClaudeLauncher({ searchPath: bin, platform: 'linux', workDir: path.join(dir, 'args') })
    const { command } = await launcher.launch({ ...request, cwd: dir, prompt: '- [ ] Ajouter le bouton\n--version' })
    const { execFileSync } = await import('node:child_process')
    const output = execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })
    assert.equal(output, '[--permission-mode]\n[plan]\n[--]\n[- [ ] Ajouter le bouton\n--version]\n')
  })

  it('transmet à la session un PATH sans les outils npm du projet', () => {
    const search = ['/repo/backend/node_modules/.bin', '/repo/node_modules/.bin', '/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin', '/opt/homebrew/bin', '/usr/bin'].join(':')
    assert.equal(sessionPath(search, '/Users/moi/.local/bin/claude'), '/Users/moi/.local/bin:/opt/homebrew/bin:/usr/bin')
    assert.equal(sessionPath(search, 'claude'), '/opt/homebrew/bin:/usr/bin')
  })

  it('sur macOS : ouvre un script .command dans le terminal choisi', async () => {
    const opened: string[][] = []
    const launcher = createClaudeLauncher({
      command: '/opt/claude/bin/claude',
      searchPath: '/usr/bin:/bin',
      platform: 'darwin',
      terminalApp: 'iTerm',
      workDir: path.join(dir, 'mac'),
      openWith: async (app, file) => {
        opened.push([app, file])
      },
    })
    const result = await launcher.launch({ ...request, permissionMode: 'default' })
    assert.equal(result.launched, true)
    assert.equal(opened.length, 1)
    const [app, script = ''] = opened[0] ?? []
    assert.equal(app, 'iTerm')
    assert.match(script, /claude-42-\d+\.command$/)
    const content = await readFile(script, 'utf8')
    assert.ok(content.startsWith('#!/bin/zsh\n'))
    assert.ok(content.includes(`cd -- '/Users/françois/dev/l'\\''atelier' || exit 1`))
    assert.ok(content.includes(`exec '/opt/claude/bin/claude' -- "$(cat -- '${result.promptFile}')"`))
    assert.ok(content.includes(`export PATH='/opt/claude/bin:/usr/bin:/bin'`))
    assert.ok(!content.includes('rm -rf'), 'le prompt reste dans son fichier, jamais dans le script')
  })
})

// --- Routes IA (Ollama et Claude simulés) -------------------------------------------------------------

class FakeOllama implements OllamaClient {
  readonly baseUrl = 'http://localhost:11434'
  models: OllamaModel[] = [{ name: 'qwen2.5-coder:latest', size: 1, parameterSize: '7.6B', family: 'qwen2' }]
  replies: (string | Error)[] = []
  requests: ChatRequest[] = []
  async listModels() {
    return this.models
  }
  async chat(request: ChatRequest) {
    this.requests.push(request)
    const reply = this.replies.shift() ?? ''
    if (reply instanceof Error) throw reply
    return reply
  }
}

class FakeClaude implements ClaudeLauncher {
  launches: ClaudeSessionRequest[] = []
  async status(): Promise<ClaudeCliStatus> {
    return { available: true, version: '2.1.300', command: '/usr/local/bin/claude', canOpenTerminal: true, terminalApp: 'Terminal', error: null }
  }
  async prepare(request: ClaudeSessionRequest) {
    return { command: `cd ${request.cwd} && claude`, promptFile: '/tmp/prompt.md' }
  }
  async launch(request: ClaudeSessionRequest) {
    this.launches.push(request)
    return { command: `cd ${request.cwd} && claude`, promptFile: '/tmp/prompt.md', launched: true }
  }
}

describe('routes IA', () => {
  const ollama = new FakeOllama()
  const claude = new FakeClaude()
  let ctx: TestContext
  let repo: TestRepo
  const api = <T = any>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => call<T>(ctx.app, method, url, payload)

  before(async () => {
    ctx = await createTestContext({ seed: true, ai: { ollama, claude, model: 'qwen2.5-coder', maxDiffChars: 4000 } })
    repo = await createTestRepo()
  })
  after(async () => {
    await ctx.close()
    await repo.close()
  })

  async function demoStory(title: string) {
    const tree = (await api('GET', `/api/projects/${ctx.demoProjectId}/tree`)).body
    for (const phase of tree.phases) for (const epic of phase.epics) for (const story of epic.stories) if (story.title === title) return story
    throw new Error(`story ${title} absente`)
  }

  it('donne l’état d’Ollama et de Claude CLI', async () => {
    const { status, body } = await api('GET', '/api/ai/status')
    assert.equal(status, 200)
    assert.deepEqual(body.ollama, {
      url: 'http://localhost:11434',
      reachable: true,
      error: null,
      defaultModel: 'qwen2.5-coder',
      defaultModelInstalled: true,
      defaultModelName: 'qwen2.5-coder:latest',
      models: ollama.models,
    })
    assert.equal(body.claude.version, '2.1.300')

    const stopped = ollama.listModels
    ollama.listModels = async () => {
      throw new OllamaError('unreachable', 'Ollama est injoignable')
    }
    const down = (await api('GET', '/api/ai/status')).body
    ollama.listModels = stopped
    assert.equal(down.ollama.reachable, false)
    assert.equal(down.ollama.error, 'Ollama est injoignable')
    assert.equal(down.ollama.defaultModelInstalled, false)
  })

  it('propose un découpage de story sans rien enregistrer', async () => {
    const story = await demoStory('Auth')
    ollama.replies.push(
      JSON.stringify({
        items: [
          { type: 'FEATURE', title: 'Déconnexion', description: '- [ ] Bouton', estimateDays: 1.5 },
          { type: 'TASK', title: 'Config JWT', description: 'déjà présent', estimateDays: 1 },
          { type: 'TASK', title: 'Rotation des clés', description: '', estimateDays: 0.5 },
        ],
      }),
    )
    const before = (await api('GET', `/api/stories/${story.id}/work-items`)).body.length
    const { status, body } = await api('POST', '/api/ai/breakdown-story', { storyId: story.id, model: 'gemma3', instructions: 'Rester simple' })
    assert.equal(status, 200)
    assert.deepEqual(body.story, { id: story.id, code: '1.1', title: 'Auth' })
    assert.equal(body.model, 'gemma3')
    assert.deepEqual(body.items, [
      { type: 'FEATURE', title: 'Déconnexion', description: '- [ ] Bouton', estimate: { hours: 12, days: 1.5 } },
      { type: 'TASK', title: 'Rotation des clés', description: '', estimate: { hours: 4, days: 0.5 } },
    ])
    const request = ollama.requests.at(-1)
    assert.equal(request?.model, 'gemma3')
    assert.ok(request?.format, 'sortie structurée demandée')
    const prompt = request?.messages.map((message) => message.content).join('\n') ?? ''
    for (const expected of ['STORY 1.1 : Auth', '#102 TASK « Config JWT » (2 j)', 'Rester simple', 'App E-Commerce v2']) assert.ok(prompt.includes(expected), expected)
    assert.equal((await api('GET', `/api/stories/${story.id}/work-items`)).body.length, before)
  })

  it('signale une réponse inexploitable, un modèle absent ou une story inconnue', async () => {
    const story = await demoStory('Auth')
    ollama.replies.push('Désolé, je ne peux pas.')
    const invalid = await api('POST', '/api/ai/breakdown-story', { storyId: story.id })
    assert.equal(invalid.status, 502)
    assert.equal(invalid.body.code, 'AI_INVALID_RESPONSE')

    ollama.replies.push(new OllamaError('model', 'Modèle absent d’Ollama'))
    const missing = await api('POST', '/api/ai/breakdown-story', { storyId: story.id, model: 'llama9' })
    assert.equal(missing.status, 502)
    assert.equal(missing.body.code, 'AI_MODEL_MISSING')

    ollama.replies.push(new OllamaError('unreachable', 'Ollama est injoignable'))
    assert.equal((await api('POST', '/api/ai/breakdown-story', { storyId: story.id })).body.code, 'AI_UNAVAILABLE')
    assert.equal((await api('POST', '/api/ai/breakdown-story', { storyId: 999_999 })).status, 404)
    assert.equal((await api('POST', '/api/ai/breakdown-story', { storyId: story.id, extra: 1 })).status, 400)
  })

  it('crée les éléments retenus en une transaction, en fin de story', async () => {
    const story = await demoStory('Thèmes')
    const existing = (await api('GET', `/api/stories/${story.id}/work-items`)).body
    const { status, body } = await api('POST', `/api/stories/${story.id}/work-items/batch`, {
      items: [
        { type: 'FEATURE', title: 'Thème auto (système)', estimatedDays: 1.5, description: '- [ ] Suit le système' },
        { type: 'TASK', title: 'Tests visuels', estimatedDays: 0.5 },
      ],
    })
    assert.equal(status, 201)
    assert.deepEqual(
      body.map((item: { title: string; estimate: unknown; position: number }) => [item.title, item.estimate, item.position]),
      [
        ['Thème auto (système)', { hours: 12, days: 1.5 }, existing.length + 1],
        ['Tests visuels', { hours: 4, days: 0.5 }, existing.length + 2],
      ],
    )
    assert.equal(body[1].id, body[0].id + 1)

    const refused = await api('POST', `/api/stories/${story.id}/work-items/batch`, {
      items: [
        { type: 'TASK', title: 'Valide' },
        { type: 'TASK', title: 'Dates inversées', startDate: '2026-10-20', dueDate: '2026-10-10' },
      ],
    })
    assert.equal(refused.status, 400)
    assert.equal((await api('GET', `/api/stories/${story.id}/work-items`)).body.length, existing.length + 2)
    assert.equal((await api('POST', `/api/stories/${story.id}/work-items/batch`, { items: [] })).status, 400)
  })

  it('résume les commits d’un élément à partir de leurs git diff', async () => {
    const created = (await api('POST', '/api/projects', { name: 'Résumé', localRepoPath: repo.dir })).body
    const phase = (await api('POST', `/api/projects/${created.id}/phases`, { title: 'P' })).body
    const epic = (await api('POST', `/api/phases/${phase.id}/epics`, { title: 'E' })).body
    const story = (await api('POST', `/api/epics/${epic.id}/stories`, { title: 'S' })).body
    const item = (await api('POST', `/api/stories/${story.id}/work-items`, { type: 'FEATURE', title: 'Export CSV', description: 'Exporter' })).body

    const empty = await api('POST', '/api/ai/summarize-commits', { workItemId: item.id })
    assert.equal(empty.status, 400)
    assert.match(empty.body.message, /Aucun commit lié/)

    await repo.commit('chore: initial commit')
    await writeFile(path.join(repo.dir, 'export.ts'), 'export function toCsv(rows: string[][]) {\n  return rows.map((r) => r.join(";")).join("\\n")\n}\n')
    await repo.git.add('export.ts')
    await repo.git.commit(`feat(export): générateur CSV feature #${item.id}`)
    await repo.commit(`test: export CSV task #${item.id}`)
    assert.equal((await api('POST', `/api/projects/${created.id}/git/scan`)).status, 200)

    ollama.replies.push('```markdown\n## Entrée\n\nAjout de `toCsv` dans export.ts.\n```')
    const { status, body } = await api('POST', '/api/ai/summarize-commits', { workItemId: item.id })
    assert.equal(status, 200)
    assert.equal(body.text, 'Ajout de `toCsv` dans export.ts.')
    assert.equal(body.model, 'qwen2.5-coder:latest', 'étiquette installée envoyée à Ollama')
    assert.deepEqual(
      body.commits.map((commit: { subject: string; diff: string }) => [commit.subject, commit.diff]),
      [
        [`feat(export): générateur CSV feature #${item.id}`, 'full'],
        [`test: export CSV task #${item.id}`, 'full'],
      ],
    )
    assert.deepEqual(body.warnings, [])
    const prompt = ollama.requests.at(-1)?.messages.map((message) => message.content).join('\n') ?? ''
    assert.ok(prompt.includes('export function toCsv'), 'le diff est transmis')
    assert.ok(prompt.includes(`FEATURE #${item.id} — Export CSV`))
    assert.ok(prompt.indexOf('générateur CSV') < prompt.indexOf('test: export CSV'), 'du plus ancien au plus récent')
    assert.equal((await api('GET', `/api/work-items/${item.id}`)).body.implementationLog, '', 'rien n’est enregistré')

    // Dépôt délié : messages seuls, avec un avertissement.
    await api('PATCH', `/api/projects/${created.id}`, { localRepoPath: null })
    ollama.replies.push('Résumé sans diff.')
    const unlinked = (await api('POST', '/api/ai/summarize-commits', { workItemId: item.id })).body
    assert.deepEqual(unlinked.commits.map((commit: { diff: string }) => commit.diff), ['missing', 'missing'])
    assert.match(unlinked.warnings[0], /seuls les messages/)

    ollama.replies.push('   ')
    assert.equal((await api('POST', '/api/ai/summarize-commits', { workItemId: item.id })).body.code, 'AI_INVALID_RESPONSE')
    await api('PATCH', `/api/projects/${created.id}`, { localRepoPath: repo.dir })
  })

  it('prépare et ouvre une session Claude CLI dans le dépôt du projet', async () => {
    const preview = await api('GET', '/api/ai/claude/prompt?workItemId=12345')
    assert.equal(preview.status, 200)
    assert.equal(preview.body.cwd, null)
    assert.match(preview.body.prompt, /^Tâche FEATURE #12345 — Implémenter le moteur de synchronisation Git/)
    assert.match(preview.body.prompt, /PHASE 1 Socle Technique › EPIC 1 Architecture › STORY 1\.2 Synchronisation Git/)
    assert.match(preview.body.prompt, /a8f4d21 feat: add regex parser for feature #12345/)

    const unlinked = await api('POST', '/api/ai/claude/launch', { workItemId: 12345 })
    assert.equal(unlinked.status, 400)
    assert.match(unlinked.body.message, /localRepoPath/)

    await api('PATCH', `/api/projects/${ctx.demoProjectId}`, { localRepoPath: repo.dir })
    const launched = await api('POST', '/api/ai/claude/launch', { workItemId: 12345, permissionMode: 'plan' })
    assert.equal(launched.status, 200)
    assert.equal(launched.body.launched, true)
    assert.deepEqual(claude.launches.at(-1), { workItemId: 12345, cwd: repo.dir, prompt: preview.body.prompt, permissionMode: 'plan' })

    await api('POST', '/api/ai/claude/launch', { workItemId: 12345, prompt: 'Corrige seulement les tests' })
    assert.deepEqual(claude.launches.at(-1), { workItemId: 12345, cwd: repo.dir, prompt: 'Corrige seulement les tests', permissionMode: 'default' })

    assert.equal((await api('POST', '/api/ai/claude/launch', { workItemId: 12345, permissionMode: 'bypassPermissions' })).status, 400)

    // Un clic depuis le panneau IA : session sur le projet, sans tâche ni prompt.
    const onProject = await api('POST', '/api/ai/claude/launch', { projectId: ctx.demoProjectId })
    assert.equal(onProject.status, 200)
    assert.deepEqual(claude.launches.at(-1), { workItemId: null, cwd: repo.dir, prompt: null, permissionMode: 'default' })
    assert.equal((await api('POST', '/api/ai/claude/launch', {})).status, 400)
    assert.equal((await api('POST', '/api/ai/claude/launch', { projectId: 999_999 })).status, 404)
    assert.equal((await api('GET', '/api/ai/claude/prompt?workItemId=999999')).status, 404)
    await api('PATCH', `/api/projects/${ctx.demoProjectId}`, { localRepoPath: '/nonexistent/repo' })
    assert.equal((await api('POST', '/api/ai/claude/launch', { workItemId: 12345 })).status, 400)
  })
})
