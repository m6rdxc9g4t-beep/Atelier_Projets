// Dépôt Git temporaire pour les tests, isolé de la configuration Git de l'utilisateur.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'

let isolated = false

/**
 * Coupe la configuration globale et système de Git pour tout le processus de test (signatures, hooksPath,
 * templates…) : les commits de test ne dépendent pas du poste, et rien n'est écrit hors du dossier temporaire.
 */
async function isolateGitConfig(): Promise<void> {
  if (isolated) return
  const dir = await mkdtemp(path.join(tmpdir(), 'atelier-git-config-'))
  const empty = path.join(dir, 'gitconfig')
  await writeFile(empty, '')
  process.env.GIT_CONFIG_GLOBAL = empty
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  isolated = true
}

export interface TestRepo {
  dir: string
  git: SimpleGit
  /** Crée un commit (fichier modifié) et renvoie son hash. */
  commit(message: string): Promise<string>
  close(): Promise<void>
}

export async function createTestRepo(): Promise<TestRepo> {
  await isolateGitConfig()
  const dir = await mkdtemp(path.join(tmpdir(), 'atelier-repo-'))
  const git = simpleGit({ baseDir: dir })
  await git.raw(['init', '--initial-branch=main'])
  await git.addConfig('user.name', 'Camille Test')
  await git.addConfig('user.email', 'camille@example.com')
  await git.addConfig('commit.gpgsign', 'false')
  let counter = 0
  return {
    dir,
    git,
    async commit(message) {
      counter += 1
      await writeFile(path.join(dir, 'journal.txt'), `modification ${counter}\n`, { flag: 'a' })
      await git.add('journal.txt')
      await git.commit(message)
      return (await git.revparse(['HEAD'])).trim()
    },
    async close() {
      await rm(dir, { recursive: true, force: true })
    },
  }
}
