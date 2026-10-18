// Accès à l'API GitHub (@octokit/rest) derrière une interface minimale, remplaçable dans les tests.
import { Octokit } from '@octokit/rest'

/** Champs utilisés d'une Pull Request renvoyée par GET /repos/{owner}/{repo}/pulls. */
export interface GitHubPullRequest {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  draft?: boolean
  merged_at: string | null
  closed_at: string | null
  created_at: string
  html_url: string
  head: { ref: string }
  base: { ref: string }
  user: { login: string } | null
}

export interface GitHubClient {
  /** Pull Requests du dépôt (ouvertes et fermées), les plus récemment mises à jour d'abord. */
  listPullRequests(owner: string, repo: string, options: { max: number }): Promise<GitHubPullRequest[]>
}

/** Échec d'un appel à GitHub ; status = code HTTP renvoyé par GitHub, absent si GitHub est injoignable. */
export class GitHubError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
  }
}

function describe(status: number | undefined): string {
  switch (status) {
    case undefined:
      return 'GitHub est injoignable (réseau ou délai dépassé)'
    case 401:
      return 'Jeton GitHub refusé : vérifier GITHUB_TOKEN'
    case 403:
    case 429:
      return 'Accès refusé par GitHub ou quota d’API atteint (renseigner GITHUB_TOKEN)'
    case 404:
      return 'Dépôt GitHub introuvable (dépôt privé : renseigner GITHUB_TOKEN)'
    default:
      return `Erreur GitHub (HTTP ${status})`
  }
}

export function createOctokitClient(options: { token?: string; baseUrl?: string; timeoutMs?: number }): GitHubClient {
  const timeoutMs = options.timeoutMs ?? 30_000

  return {
    async listPullRequests(owner, repo, { max }) {
      // Un client par synchronisation : le délai (signal) s'applique à toutes les pages, pagination comprise.
      const octokit = new Octokit({
        ...(options.token && { auth: options.token }),
        ...(options.baseUrl && { baseUrl: options.baseUrl }),
        userAgent: 'atelier-projets-git-engine',
        request: { signal: AbortSignal.timeout(timeoutMs) },
        // Les échecs sont rapportés par l'API elle-même : pas de journal Octokit en double sur la console.
        log: { debug: () => {}, info: () => {}, warn: console.warn, error: () => {} },
      })
      const pulls: GitHubPullRequest[] = []
      try {
        const pages = octokit.paginate.iterator(octokit.rest.pulls.list, {
          owner,
          repo,
          state: 'all',
          sort: 'updated',
          direction: 'desc',
          per_page: 100,
        })
        for await (const page of pages) {
          for (const pull of page.data) {
            pulls.push(pull as GitHubPullRequest)
            if (pulls.length >= max) return pulls
          }
        }
        return pulls
      } catch (error) {
        // Octokit signale aussi un échec réseau par un statut 500 : seul un statut accompagné d'une réponse vient de GitHub.
        const failure = error as { status?: unknown; response?: unknown }
        const status = typeof failure.status === 'number' && failure.response !== undefined ? failure.status : undefined
        throw new GitHubError(describe(status), status)
      }
    },
  }
}
