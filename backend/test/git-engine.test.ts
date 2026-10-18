// Tests d'intégration du git-engine : vrai dépôt Git temporaire, hook post-commit, GitHub simulé
// et client Octokit réel face à un faux serveur d'API GitHub local.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createOctokitClient, GitHubError, type GitHubClient, type GitHubPullRequest } from '../src/git-engine/github.ts'
import { hookMarkers } from '../src/git-engine/hook.ts'
import { createTestRepo, type TestRepo } from './helpers/git-repo.ts'
import { call, createTestContext, type TestContext } from './helpers/test-app.ts'

/** GitHub simulé : renvoie la liste fournie par le test, ou lève l'erreur fournie. */
class FakeGitHub implements GitHubClient {
  pulls: GitHubPullRequest[] = []
  failure: GitHubError | null = null
  calls: Array<{ owner: string; repo: string; max: number }> = []
  async listPullRequests(owner: string, repo: string, options: { max: number }) {
    this.calls.push({ owner, repo, max: options.max })
    if (this.failure) throw this.failure
    return this.pulls
  }
}

const NOW = new Date('2026-10-20T08:00:00Z')
const github = new FakeGitHub()
let ctx: TestContext
let repo: TestRepo

before(async () => {
  ctx = await createTestContext({ now: () => NOW, github, publicUrl: 'http://127.0.0.1:3000', githubMaxPullRequests: 250 })
  repo = await createTestRepo()
})
after(async () => {
  await ctx.close()
  await repo.close()
})

const api = <T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  call<T>(ctx.app, method, url, payload)

/** Projet avec une story et des éléments ; renvoie les ids. */
async function project(name: string, fields: Record<string, unknown>, items: string[]) {
  const p = (await api('POST', '/api/projects', { name, ...fields })).body
  const phase = (await api('POST', `/api/projects/${p.id}/phases`, { title: 'Phase' })).body
  const epic = (await api('POST', `/api/phases/${phase.id}/epics`, { title: 'Epic' })).body
  const story = (await api('POST', `/api/epics/${epic.id}/stories`, { title: 'Story' })).body
  const ids: number[] = []
  for (const title of items) ids.push((await api('POST', `/api/stories/${story.id}/work-items`, { type: 'TASK', title })).body.id)
  return { projectId: p.id as number, storyId: story.id as number, ids }
}

describe('analyse du dépôt Git local', () => {
  let projectId = 0
  let storyId = 0
  let a = 0
  let b = 0
  let c = 0

  before(async () => {
    const created = await project('Boutique', {}, ['Connexion', 'Panier', 'Export'])
    projectId = created.projectId
    storyId = created.storyId
    ;[a = 0, b = 0, c = 0] = created.ids
    await api('PATCH', `/api/projects/${projectId}`, { localRepoPath: repo.dir })

    await repo.commit('chore: initial commit')
    await repo.commit(`feat(auth): login form feature #${a}`)
    await repo.commit(`fix: crash on empty cart bug #${b} ref #${a}\n\nVoir aussi #99999 et task #${c + 1}.`)
    await repo.commit(`fix: résolution des accents bug #${b}`)
    await repo.git.checkoutLocalBranch(`feature/${c}-export`)
    await repo.commit(`task #${c}: export CSV`)
    await repo.commit(`wip: tests TASK #${c}`)
    await repo.git.checkout('main')
    await repo.git.raw(['merge', '--no-ff', '-m', `Merge branch 'feature/${c}-export' (#${b})`, `feature/${c}-export`])
  })

  it('rattache les commits qui citent un #ID du projet, sans les merges', async () => {
    const { status, body } = await api('POST', `/api/projects/${projectId}/git/scan`)
    assert.equal(status, 200, JSON.stringify(body))
    assert.deepEqual(body, {
      branches: [`feature/${c}-export`, 'main'],
      commitsRead: 6,
      commitsCreated: 6,
      linksCreated: 6,
      commitsRemoved: 0,
      truncated: false,
      unknownReferences: [c + 1, 99999],
      scannedAt: NOW.toISOString(),
    })
    const commits = (await api('GET', `/api/projects/${projectId}/commits`)).body
    assert.equal(commits.length, 6)
    assert.ok(!commits.some((commit: { message: string }) => commit.message.startsWith('Merge')))
    assert.ok(commits.some((commit: { message: string }) => commit.message === `fix: résolution des accents bug #${b}`))
    assert.equal((await api('GET', `/api/projects/${projectId}`)).body.gitScannedAt, NOW.toISOString())
  })

  it('garde la branche d’origine d’un commit fusionné et les mots-clés détectés', async () => {
    const onExport = (await api('GET', `/api/projects/${projectId}/commits?workItemId=${c}`)).body
    assert.deepEqual(
      onExport.map((commit: { branch: string }) => commit.branch),
      [`feature/${c}-export`, `feature/${c}-export`],
    )
    const detail = (await api('GET', `/api/work-items/${a}`)).body
    assert.deepEqual(
      detail.commits.map((commit: { keyword: string; message: string }) => [commit.keyword, commit.message.split('\n')[0]]),
      [
        ['ref', `fix: crash on empty cart bug #${b} ref #${a}`],
        ['feature', `feat(auth): login form feature #${a}`],
      ],
    )
    const fix = detail.commits[0]
    assert.equal(fix.shortHash, fix.hash.slice(0, 7))
    assert.equal(fix.authorName, 'Camille Test')
    assert.equal(fix.branch, 'main')
  })

  it('est idempotent et complète les liens d’un élément créé après coup', async () => {
    const again = (await api('POST', `/api/projects/${projectId}/git/scan`)).body
    assert.deepEqual([again.commitsCreated, again.linksCreated], [0, 0])

    const late = (await api('POST', `/api/stories/${storyId}/work-items`, { type: 'BUG', title: 'Créé après le commit' })).body
    assert.equal(late.id, c + 1)
    const third = (await api('POST', `/api/projects/${projectId}/git/scan`)).body
    assert.deepEqual([third.commitsCreated, third.linksCreated, third.unknownReferences], [0, 1, [99999]])
    assert.equal((await api('GET', `/api/work-items/${late.id}`)).body.commits[0].keyword, 'task')
  })

  it('ne rattache pas un #ID d’un autre projet', async () => {
    const other = await project('Autre boutique', { localRepoPath: repo.dir }, [])
    const scan = (await api('POST', `/api/projects/${other.projectId}/git/scan`)).body
    assert.equal(scan.commitsCreated, 6)
    assert.equal(scan.linksCreated, 0)
    assert.equal(await ctx.prisma.gitCommitLink.count({ where: { commit: { projectId: other.projectId } } }), 0)
  })

  it('refuse un projet sans dépôt ou un chemin qui n’est pas un dépôt Git', async () => {
    const bare = await project('Sans dépôt', {}, [])
    const none = await api('POST', `/api/projects/${bare.projectId}/git/scan`)
    assert.equal(none.status, 400)
    assert.match(none.body.message, /localRepoPath/)

    const plain = await mkdtemp(path.join(tmpdir(), 'atelier-not-git-'))
    try {
      await api('PATCH', `/api/projects/${bare.projectId}`, { localRepoPath: plain })
      const notGit = await api('POST', `/api/projects/${bare.projectId}/git/scan`)
      assert.equal(notGit.status, 400)
      assert.match(notGit.body.message, /racine d’un dépôt Git/)
      await api('PATCH', `/api/projects/${bare.projectId}`, { localRepoPath: 'relatif/depot' })
      assert.match((await api('POST', `/api/projects/${bare.projectId}/git/scan`)).body.message, /non absolu/)
      await api('PATCH', `/api/projects/${bare.projectId}`, { localRepoPath: path.join(plain, 'absent') })
      assert.match((await api('POST', `/api/projects/${bare.projectId}/git/scan`)).body.message, /introuvable/)
    } finally {
      await rm(plain, { recursive: true, force: true })
    }
  })
})

describe('analyse : cas limites du dépôt', () => {
  it('attribue les branches sur la ligne directe, même avec une branche créée après la fusion', async () => {
    const r = await createTestRepo()
    try {
      const { projectId, ids } = await project('Branches', { localRepoPath: r.dir }, ['Export'])
      const [item = 0] = ids
      await r.commit('chore: initial commit')
      await r.git.checkoutLocalBranch(`feature/${item}-export`)
      await r.commit(`task #${item}: export`)
      await r.git.checkout('main')
      await r.git.raw(['merge', '--no-ff', '-m', 'Merge export', `feature/${item}-export`])
      await r.git.checkoutLocalBranch('a-later-branch') // triée avant feature/… et contient le commit fusionné
      await r.commit('docs: après la fusion')
      const scan = (await api('POST', `/api/projects/${projectId}/git/scan`)).body
      assert.deepEqual(scan.branches, ['a-later-branch', `feature/${item}-export`, 'main'])
      const commits = (await api('GET', `/api/projects/${projectId}/commits`)).body as Array<{ message: string; branch: string }>
      const branchOf = Object.fromEntries(commits.map((commit) => [commit.message, commit.branch]))
      assert.deepEqual(branchOf, {
        'chore: initial commit': 'main',
        [`task #${item}: export`]: `feature/${item}-export`,
        'docs: après la fusion': 'a-later-branch',
      })
    } finally {
      await r.close()
    }
  })

  it('lit les commits d’une branche fusionnée puis supprimée, et un message encodé en Latin-1', async () => {
    const r = await createTestRepo()
    try {
      const { projectId, ids } = await project('Fusion supprimée', { localRepoPath: r.dir }, ['Corbeille'])
      const [item = 0] = ids
      await r.commit('chore: initial commit')
      await r.git.checkoutLocalBranch('feature/trash')
      await r.commit(`feat: corbeille feature #${item}`)
      await r.git.checkout('main')
      await r.git.raw(['merge', '--no-ff', '-m', 'Merge trash', 'feature/trash'])
      await r.git.raw(['branch', '-d', 'feature/trash'])
      const latin1 = path.join(r.dir, 'message.txt')
      await writeFile(latin1, Buffer.from('fix: accentuée en Latin-1 bug #' + item + '\n', 'latin1'))
      await writeFile(path.join(r.dir, 'journal.txt'), 'latin\n', { flag: 'a' })
      await r.git.add('journal.txt')
      execFileSync('git', ['-c', 'i18n.commitEncoding=ISO-8859-1', 'commit', '-q', '-F', latin1], { cwd: r.dir })
      // configuration de l'utilisateur qui ferait sortir git log en Latin-1 : l'analyse doit rester en UTF-8
      execFileSync('git', ['config', 'i18n.logOutputEncoding', 'ISO-8859-1'], { cwd: r.dir })

      const scan = (await api('POST', `/api/projects/${projectId}/git/scan`)).body
      assert.deepEqual([scan.branches, scan.commitsCreated, scan.linksCreated], [['main'], 3, 2])
      const messages = (await api('GET', `/api/work-items/${item}`)).body.commits.map((commit: { message: string; branch: string }) => [commit.message, commit.branch])
      assert.deepEqual(messages, [
        [`fix: accentuée en Latin-1 bug #${item}`, 'main'],
        [`feat: corbeille feature #${item}`, 'main'],
      ])
    } finally {
      await r.close()
    }
  })

  it('analyse une HEAD détachée et respecte la branche par défaut du projet', async () => {
    const r = await createTestRepo()
    try {
      const { projectId } = await project('Détachée', { localRepoPath: r.dir, defaultBranch: 'main' }, [])
      const first = await r.commit('chore: initial commit')
      await r.git.checkoutLocalBranch('develop')
      await r.commit('feat: sur develop')
      await r.git.checkout(first) // HEAD détachée (rebase, bisect…)
      const scan = await api('POST', `/api/projects/${projectId}/git/scan`)
      assert.equal(scan.status, 200, JSON.stringify(scan.body))
      assert.deepEqual(scan.body.branches, ['develop', 'main'])
      const commits = (await api('GET', `/api/projects/${projectId}/commits`)).body as Array<{ message: string; branch: string }>
      assert.deepEqual(
        commits.map((commit) => [commit.message, commit.branch]).sort(),
        [['chore: initial commit', 'main'], ['feat: sur develop', 'develop']],
      )
    } finally {
      await r.close()
    }
  })

  it('retire les commits disparus (amend) et garde les messages intacts', async () => {
    const r = await createTestRepo()
    try {
      const { projectId, ids } = await project('Amend', { localRepoPath: r.dir }, ['Tâche'])
      const [item = 0] = ids
      await r.commit('chore: initial commit')
      await r.commit(`feat: brouillon task #${item}\n\nséparateurs \x1e et \x1f conservés (#99)`)
      const first = (await api('POST', `/api/projects/${projectId}/git/scan`)).body
      assert.deepEqual([first.commitsCreated, first.linksCreated, first.unknownReferences], [2, 1, [99]])
      const stored = (await api('GET', `/api/work-items/${item}`)).body.commits[0].message as string
      assert.ok(stored.endsWith('séparateurs \x1e et \x1f conservés (#99)'))

      await r.git.raw(['commit', '--amend', '-m', `feat: version finale task #${item} (#57)`])
      const second = (await api('POST', `/api/projects/${projectId}/git/scan`)).body
      assert.deepEqual([second.commitsCreated, second.commitsRemoved, second.unknownReferences], [1, 1, []])
      const detail = (await api('GET', `/api/work-items/${item}`)).body
      assert.deepEqual(detail.commits.map((commit: { message: string }) => commit.message), [`feat: version finale task #${item} (#57)`])
    } finally {
      await r.close()
    }
  })

  it('accepte un worktree lié et sérialise les analyses simultanées', async () => {
    const r = await createTestRepo()
    const worktree = path.join(await mkdtemp(path.join(tmpdir(), 'atelier-wt-')), 'wt')
    try {
      const { projectId } = await project('Worktree', {}, [])
      await r.commit('chore: initial commit')
      await r.git.raw(['worktree', 'add', '-b', 'wt-branch', worktree])
      await api('PATCH', `/api/projects/${projectId}`, { localRepoPath: worktree })
      const scans = await Promise.all([1, 2, 3].map(() => api('POST', `/api/projects/${projectId}/git/scan`)))
      assert.deepEqual(scans.map((scan) => scan.status), [200, 200, 200])
      assert.deepEqual(scans.map((scan) => scan.body.commitsCreated).sort(), [0, 0, 1])
    } finally {
      await rm(path.dirname(worktree), { recursive: true, force: true })
      await r.close()
    }
  })
})

describe('hook post-commit', () => {
  it('s’installe, reste unique, préserve un hook existant et se retire proprement', async () => {
    const { projectId } = await project('Hook', {}, [])
    const own = await createTestRepo()
    try {
      await own.commit('chore: initial commit')
      await api('PATCH', `/api/projects/${projectId}`, { localRepoPath: own.dir })
      const hookFile = path.join(own.dir, '.git', 'hooks', 'post-commit')
      const scanUrl = `http://127.0.0.1:3000/api/projects/${projectId}/git/scan`

      assert.deepEqual((await api('GET', `/api/projects/${projectId}/git/hook`)).body, { path: hookFile, installed: false, scanUrl })
      await writeFile(hookFile, '#!/bin/sh\necho "lint"\n', { mode: 0o755 })

      const installed = await api('PUT', `/api/projects/${projectId}/git/hook`)
      assert.deepEqual(installed.body, { path: hookFile, installed: true, scanUrl })
      await api('PUT', `/api/projects/${projectId}/git/hook`)
      const content = await readFile(hookFile, 'utf8')
      assert.equal(content.split(hookMarkers(projectId).begin).length, 2)
      assert.ok(content.startsWith(`#!/bin/sh\n${hookMarkers(projectId).begin}`))
      assert.ok(content.endsWith('echo "lint"\n'))
      assert.ok(content.includes(`'${scanUrl}'`))
      assert.equal((await stat(hookFile)).mode & 0o111, 0o111)

      const removed = await api('DELETE', `/api/projects/${projectId}/git/hook`)
      assert.equal(removed.body.installed, false)
      assert.equal(await readFile(hookFile, 'utf8'), '#!/bin/sh\necho "lint"\n')

      await rm(hookFile)
      await api('PUT', `/api/projects/${projectId}/git/hook`)
      await api('DELETE', `/api/projects/${projectId}/git/hook`)
      assert.equal(await stat(hookFile).catch(() => null), null)
    } finally {
      await own.close()
    }
  })
})

describe('hook post-commit : garde-fous', () => {
  it('refuse un dossier de hooks hors du dépôt (core.hooksPath) et un hook lien symbolique', async () => {
    const r = await createTestRepo()
    const outside = await mkdtemp(path.join(tmpdir(), 'atelier-shared-hooks-'))
    try {
      const { projectId } = await project('Garde-fous', { localRepoPath: r.dir }, [])
      await r.commit('chore: initial commit')

      execFileSync('git', ['config', 'core.hooksPath', outside], { cwd: r.dir }) // simple-git bloque ce réglage, à raison
      const shared = await api('PUT', `/api/projects/${projectId}/git/hook`)
      assert.equal(shared.status, 400)
      assert.match(shared.body.message, /core\.hooksPath/)
      assert.equal(await stat(path.join(outside, 'post-commit')).catch(() => null), null)
      execFileSync('git', ['config', '--unset', 'core.hooksPath'], { cwd: r.dir })

      const target = path.join(outside, 'team-post-commit')
      await writeFile(target, '#!/bin/sh\necho équipe\n', { mode: 0o755 })
      await symlink(target, path.join(r.dir, '.git', 'hooks', 'post-commit'))
      const linked = await api('PUT', `/api/projects/${projectId}/git/hook`)
      assert.equal(linked.status, 400)
      assert.match(linked.body.message, /lien symbolique/)
      assert.equal(await readFile(target, 'utf8'), '#!/bin/sh\necho équipe\n')
    } finally {
      await rm(outside, { recursive: true, force: true })
      await r.close()
    }
  })
})

const pull = (fields: Partial<GitHubPullRequest> & Pick<GitHubPullRequest, 'number' | 'title'>): GitHubPullRequest => ({
  body: '',
  state: 'open',
  draft: false,
  merged_at: null,
  closed_at: null,
  created_at: '2026-10-15T09:00:00Z',
  html_url: `https://github.com/acme/shop/pull/${fields.number}`,
  head: { ref: 'feature/x' },
  base: { ref: 'main' },
  user: { login: 'camille' },
  ...fields,
})

describe('synchronisation des Pull Requests GitHub', () => {
  it('importe les PR, les relie aux éléments et affiche leur statut', async () => {
    const { projectId, ids } = await project('Shop', { githubOwner: 'acme', githubRepo: 'shop' }, ['Login', 'Panier', 'Export'])
    const [a, b, c] = ids as [number, number, number]
    github.pulls = [
      pull({ number: 7, title: `Login form feature #${a}`, head: { ref: 'feature/login' } }),
      pull({ number: 8, title: 'WIP export', body: `Closes #${c} and refs #99`, draft: true, head: { ref: `feature/${c}-export` } }),
      pull({ number: 9, title: 'Fix cart', state: 'closed', merged_at: '2026-10-16T10:00:00Z', closed_at: '2026-10-16T10:00:00Z', head: { ref: `bug/${b}-cart` } }),
      pull({ number: 10, title: 'Spike abandonné', state: 'closed', closed_at: '2026-10-17T10:00:00Z', head: { ref: 'spike' } }),
    ]

    const sync = await api('POST', `/api/projects/${projectId}/github/sync`)
    assert.equal(sync.status, 200, JSON.stringify(sync.body))
    assert.deepEqual(sync.body, { pullRequests: 4, created: 4, updated: 0, linkedWorkItems: 3, syncedAt: NOW.toISOString() })
    assert.deepEqual(github.calls.at(-1), { owner: 'acme', repo: 'shop', max: 250 })

    const list = (await api('GET', `/api/projects/${projectId}/pull-requests`)).body
    assert.deepEqual(
      list.map((pr: { number: number; state: string; status: string; workItemIds: number[] }) => [pr.number, pr.state, pr.status, pr.workItemIds]),
      [
        [10, 'CLOSED', 'REJECTED', []],
        [9, 'MERGED', 'CLOSED', [b]],
        [8, 'OPEN', 'IN_PROGRESS', [c]],
        [7, 'OPEN', 'IN_REVIEW', [a]],
      ],
    )
    const open = (await api('GET', `/api/projects/${projectId}/pull-requests?state=OPEN`)).body
    assert.deepEqual(open.map((pr: { number: number }) => pr.number), [8, 7])

    const detail = (await api('GET', `/api/work-items/${c}`)).body
    assert.deepEqual(
      detail.pullRequests.map((pr: { number: number; status: string; source: string; url: string }) => [pr.number, pr.status, pr.source, pr.url]),
      [[8, 'IN_PROGRESS', 'body', 'https://github.com/acme/shop/pull/8']],
    )
    assert.equal((await api('GET', `/api/projects/${projectId}`)).body.githubSyncedAt, NOW.toISOString())

    // Deuxième synchronisation : la PR #8 est fusionnée et son titre cite maintenant #a
    github.pulls[1] = { ...github.pulls[1]!, title: `Export feature #${a}`, body: '', state: 'closed', merged_at: '2026-10-19T10:00:00Z' }
    const resync = (await api('POST', `/api/projects/${projectId}/github/sync`)).body
    assert.deepEqual([resync.created, resync.updated, resync.linkedWorkItems], [0, 4, 4])
    const pr8 = (await api('GET', `/api/projects/${projectId}/pull-requests`)).body.find((pr: { number: number }) => pr.number === 8)
    assert.deepEqual([pr8.state, pr8.status, pr8.workItemIds], ['MERGED', 'CLOSED', [a, c]])
    // les statuts des éléments ne sont pas modifiés par la synchronisation
    assert.equal((await api('GET', `/api/work-items/${c}`)).body.status, 'OPEN')
  })

  it('signale les erreurs GitHub (502) et un projet sans dépôt GitHub (400)', async () => {
    const { projectId } = await project('Privé', { githubOwner: 'acme', githubRepo: 'private' }, [])
    github.failure = new GitHubError('Jeton GitHub refusé : vérifier GITHUB_TOKEN', 401)
    try {
      const failed = await api('POST', `/api/projects/${projectId}/github/sync`)
      assert.equal(failed.status, 502)
      assert.deepEqual([failed.body.code, failed.body.message], ['GITHUB_ERROR', 'Jeton GitHub refusé : vérifier GITHUB_TOKEN'])
    } finally {
      github.failure = null
    }
    const local = await project('Local', {}, [])
    const missing = await api('POST', `/api/projects/${local.projectId}/github/sync`)
    assert.equal(missing.status, 400)
    assert.match(missing.body.message, /githubOwner/)
  })
})

describe('client Octokit (faux serveur d’API GitHub)', () => {
  let server: Server
  let baseUrl: string
  const requests: string[] = []

  before(async () => {
    server = createServer((request, response) => {
      requests.push(request.url ?? '')
      const url = new URL(request.url ?? '/', 'http://localhost')
      response.setHeader('content-type', 'application/json')
      if (url.pathname === '/repos/acme/private/pulls') {
        response.statusCode = 401
        response.end(JSON.stringify({ message: 'Bad credentials' }))
        return
      }
      if (url.pathname !== '/repos/acme/shop/pulls') {
        response.statusCode = 404
        response.end(JSON.stringify({ message: 'Not Found' }))
        return
      }
      const page = Number(url.searchParams.get('page') ?? '1')
      if (page === 1) {
        response.setHeader('link', `<${baseUrl}/repos/acme/shop/pulls?state=all&page=2>; rel="next"`)
        response.end(JSON.stringify([pull({ number: 3, title: 'Trois' }), pull({ number: 2, title: 'Deux' })]))
      } else {
        response.end(JSON.stringify([pull({ number: 1, title: 'Un' })]))
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })
  after(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  it('suit la pagination, s’arrête au maximum demandé et traduit les erreurs', async () => {
    const client = createOctokitClient({ baseUrl, token: 'jeton-de-test' })
    const all = await client.listPullRequests('acme', 'shop', { max: 10 })
    assert.deepEqual(all.map((pr) => pr.number), [3, 2, 1])
    assert.ok(requests[0]?.includes('state=all') && requests[0].includes('sort=updated') && requests[0].includes('per_page=100'))

    const capped = await client.listPullRequests('acme', 'shop', { max: 2 })
    assert.deepEqual(capped.map((pr) => pr.number), [3, 2])

    await assert.rejects(client.listPullRequests('acme', 'private', { max: 10 }), (error: unknown) => {
      assert.ok(error instanceof GitHubError)
      assert.equal(error.status, 401)
      assert.match(error.message, /GITHUB_TOKEN/)
      return true
    })
    await assert.rejects(client.listPullRequests('acme', 'absent', { max: 10 }), /introuvable/)
    await assert.rejects(createOctokitClient({ baseUrl: 'http://127.0.0.1:9' }).listPullRequests('a', 'b', { max: 1 }), /injoignable/)
  })

  it('abandonne après le délai si GitHub ne répond pas', async () => {
    const silent = createServer(() => {}) // accepte la connexion, ne répond jamais
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
    const address = silent.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      const started = Date.now()
      const client = createOctokitClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 300 })
      await assert.rejects(client.listPullRequests('acme', 'shop', { max: 10 }), /injoignable/)
      assert.ok(Date.now() - started < 5000)
    } finally {
      silent.closeAllConnections()
      await new Promise((resolve) => silent.close(resolve))
    }
  })
})
