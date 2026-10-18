// Lecture d'un dépôt Git local avec simple-git : commits (hors merges) des branches locales.
import { randomBytes } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'

export class GitRepositoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitRepositoryError'
  }
}

export interface RepositoryCommit {
  hash: string
  authorName: string
  authorEmail: string
  committedAt: Date
  /** Message complet (titre + corps). */
  message: string
  /** Branche locale attribuée au commit (cf. readRepositoryCommits). */
  branch: string
}

const HASH = /^[0-9a-f]{40,64}$/

/** Ouvre un dépôt : chemin absolu d'un dossier existant, racine d'un dépôt Git (worktree et sous-module compris). */
export async function openRepository(repoPath: string): Promise<SimpleGit> {
  if (!path.isAbsolute(repoPath)) throw new GitRepositoryError(`Chemin du dépôt non absolu : « ${repoPath} »`)
  const info = await stat(repoPath).catch(() => null)
  if (!info?.isDirectory()) throw new GitRepositoryError(`Dossier du dépôt introuvable : « ${repoPath} »`)
  // Sortie stable quelle que soit la configuration globale de l'utilisateur (signatures, encodage).
  const git = simpleGit({
    baseDir: repoPath,
    maxConcurrentProcesses: 4,
    config: ['log.showSignature=false', 'i18n.logOutputEncoding=UTF-8', 'core.quotePath=false'],
  })
  const topLevel = (await git.raw(['rev-parse', '--show-toplevel']).catch(() => '')).trim()
  const sameDirectory = topLevel !== '' && (await realpath(topLevel).catch(() => topLevel)) === (await realpath(repoPath))
  if (!sameDirectory) throw new GitRepositoryError(`« ${repoPath} » n’est pas la racine d’un dépôt Git`)
  return git
}

/** Branches locales (une HEAD détachée, pendant un rebase ou un bisect, n'en est pas une). */
async function localBranches(git: SimpleGit): Promise<{ all: string[]; current: string | null }> {
  const all = (await git.raw(['for-each-ref', '--format=%(refname:short)', 'refs/heads']))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const current = (await git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim() || null
  return { all, current }
}

async function revList(git: SimpleGit, branch: string, firstParent: boolean, max: number): Promise<string[]> {
  const output = await git.raw([
    'rev-list',
    ...(firstParent ? ['--first-parent'] : []),
    '--no-merges',
    `--max-count=${max}`,
    `refs/heads/${branch}`,
    '--',
  ])
  return output.split('\n').filter((line) => HASH.test(line))
}

/** Détails des commits demandés ; un séparateur aléatoire isole les messages (quels que soient leurs caractères). */
async function details(git: SimpleGit, wanted: readonly string[]): Promise<Map<string, Omit<RepositoryCommit, 'branch'>>> {
  const result = new Map<string, Omit<RepositoryCommit, 'branch'>>()
  const boundary = `--atelier-${randomBytes(16).toString('hex')}--`
  for (let index = 0; index < wanted.length; index += 500) {
    const output = await git.raw([
      'show',
      '--no-patch',
      '--encoding=UTF-8',
      `--format=${boundary}%n%H%n%an%n%ae%n%cI%n%B`,
      ...wanted.slice(index, index + 500),
      '--',
    ])
    for (const block of output.split(`${boundary}\n`)) {
      const [hash = '', authorName = '', authorEmail = '', date = '', ...message] = block.split('\n')
      if (!HASH.test(hash)) continue
      result.set(hash, { hash, authorName, authorEmail, committedAt: new Date(date), message: message.join('\n').trim() })
    }
  }
  return result
}

/**
 * Commits des branches locales, sans les merges (« Merge pull request #42 » ne doit rien rattacher).
 * Branche attribuée à chaque commit, par ordre de priorité :
 * 1. la ligne directe (--first-parent) de la branche principale (branche par défaut, sinon la branche courante) ;
 * 2. la ligne directe d'une autre branche (ordre alphabétique) : un commit fusionné garde sa branche d'origine ;
 * 3. sinon la première branche qui le contient.
 * Seuls les commits absents de `known` sont lus en détail. `reachable` liste les commits encore présents ;
 * `truncated` signale qu'au moins une branche dépasse la limite de lecture.
 */
export async function readRepositoryCommits(
  repoPath: string,
  options: { defaultBranch: string; maxPerBranch: number; known?: ReadonlySet<string> },
): Promise<{ branches: string[]; commits: RepositoryCommit[]; reachable: Set<string>; truncated: boolean }> {
  const git = await openRepository(repoPath)
  const { all, current } = await localBranches(git)
  if (all.length === 0) return { branches: [], commits: [], reachable: new Set(), truncated: false }
  const mainline = all.includes(options.defaultBranch)
    ? options.defaultBranch
    : current !== null && all.includes(current)
      ? current
      : (all[0] as string)
  const others = all.filter((branch) => branch !== mainline).sort()

  const branchOf = new Map<string, string>()
  let truncated = false
  const read = async (branch: string, firstParent: boolean) => {
    const list = await revList(git, branch, firstParent, options.maxPerBranch)
    if (list.length >= options.maxPerBranch) truncated = true
    for (const hash of list) if (!branchOf.has(hash)) branchOf.set(hash, branch)
  }
  await read(mainline, true)
  for (const branch of others) await read(branch, true)
  for (const branch of [...others, mainline]) await read(branch, false)

  const unknown = [...branchOf.keys()].filter((hash) => !options.known?.has(hash))
  const found = await details(git, unknown)
  const commits = unknown.flatMap((hash) => {
    const commit = found.get(hash)
    return commit ? [{ ...commit, branch: branchOf.get(hash) as string }] : []
  })
  return { branches: [...others, mainline], commits, reachable: new Set(branchOf.keys()), truncated }
}

/** Dossier Git commun du dépôt (partagé par ses worktrees) et dossier des hooks réellement utilisé par Git. */
export async function gitDirectories(repoPath: string): Promise<{ commonDir: string; hooksDir: string }> {
  const git = await openRepository(repoPath)
  const absolute = async (args: string[]) => {
    const resolved = path.resolve(repoPath, (await git.raw(args)).trim())
    return realpath(resolved).catch(() => resolved)
  }
  return { commonDir: await absolute(['rev-parse', '--git-common-dir']), hooksDir: await absolute(['rev-parse', '--git-path', 'hooks']) }
}
