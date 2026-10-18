// Hook post-commit : après chaque commit, demande à l'API locale de relancer l'analyse du dépôt.
// Le bloc, propre à chaque projet, est délimité par des marqueurs et placé juste après le shebang :
// il s'exécute même si le hook existant se termine par `exit`, et le reste du fichier est conservé.
import { chmod, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { GitRepositoryError, gitDirectories } from './repository.ts'

const SHELL_SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+)?(?:\S*\/)?(?:sh|bash|zsh|dash|ksh)(?:\s.*)?$/

export function hookMarkers(projectId: number): { begin: string; end: string } {
  return {
    begin: `# >>> atelier-projets (git-engine) projet ${projectId} >>>`,
    end: `# <<< atelier-projets (git-engine) projet ${projectId} <<<`,
  }
}

export function hookBlock(projectId: number, scanUrl: string): string {
  const { begin, end } = hookMarkers(projectId)
  return [
    begin,
    '# Relance l’analyse des commits d’Atelier_Projets, en arrière-plan (le commit n’est jamais bloqué).',
    `curl -fsS -m 5 -X POST '${scanUrl}' >/dev/null 2>&1 &`,
    end,
  ].join('\n')
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function removeBlock(content: string, projectId: number): string {
  const { begin, end } = hookMarkers(projectId)
  return content.replace(new RegExp(`${escape(begin)}[\\s\\S]*?${escape(end)}\\n?`, 'g'), '')
}

/** Contenu du hook avec le bloc du projet, juste après le shebang (fichier créé s'il n'existe pas). */
export function withHookBlock(existing: string | null, projectId: number, scanUrl: string): string {
  const block = `${hookBlock(projectId, scanUrl)}\n`
  if (existing === null || existing.trim() === '') return `#!/bin/sh\n${block}`
  const content = removeBlock(existing, projectId)
  const firstLine = content.split('\n', 1)[0] ?? ''
  if (!firstLine.startsWith('#!')) return `${block}${content}`
  if (!SHELL_SHEBANG.test(firstLine)) {
    throw new GitRepositoryError(`Le hook post-commit existant n’est pas un script shell (${firstLine}) : ajouter l’appel à la main`)
  }
  return `${firstLine}\n${block}${content.slice(firstLine.length + 1)}`
}

/** Contenu du hook sans le bloc du projet ; null s'il ne reste qu'un shebang. */
export function withoutHookBlock(existing: string, projectId: number): string | null {
  const rest = removeBlock(existing, projectId)
  return /^(#!.*)?\s*$/.test(rest) ? null : rest
}

export interface HookStatus {
  path: string
  installed: boolean
}

/**
 * Fichier post-commit du dépôt. Refuse un dossier de hooks extérieur au dépôt (core.hooksPath global ou
 * versionné, ex. .husky) et un hook qui est un lien symbolique : on n'écrit que dans le dépôt lui-même.
 */
async function hookFile(repoPath: string): Promise<string> {
  const { commonDir, hooksDir } = await gitDirectories(repoPath)
  if (path.relative(commonDir, hooksDir).startsWith('..') || path.isAbsolute(path.relative(commonDir, hooksDir))) {
    throw new GitRepositoryError(
      `Les hooks de ce dépôt sont dans « ${hooksDir} » (core.hooksPath), hors du dossier Git : installation automatique refusée`,
    )
  }
  const file = path.join(hooksDir, 'post-commit')
  const info = await lstat(file).catch(() => null)
  if (info?.isSymbolicLink()) {
    throw new GitRepositoryError(`« ${file} » est un lien symbolique : installation automatique refusée`)
  }
  return file
}

async function readHook(file: string): Promise<string | null> {
  return readFile(file, 'utf8').catch(() => null)
}

export async function hookStatus(repoPath: string, projectId: number): Promise<HookStatus> {
  const { hooksDir } = await gitDirectories(repoPath)
  const file = path.join(hooksDir, 'post-commit')
  const content = await readHook(file)
  return { path: file, installed: content?.includes(hookMarkers(projectId).begin) ?? false }
}

export async function installHook(repoPath: string, projectId: number, scanUrl: string): Promise<HookStatus> {
  const file = await hookFile(repoPath)
  const content = withHookBlock(await readHook(file), projectId, scanUrl)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
  await chmod(file, 0o755)
  return { path: file, installed: true }
}

export async function uninstallHook(repoPath: string, projectId: number): Promise<HookStatus> {
  const file = await hookFile(repoPath)
  const content = await readHook(file)
  if (content !== null && content.includes(hookMarkers(projectId).begin)) {
    const rest = withoutHookBlock(content, projectId)
    if (rest === null) await rm(file, { force: true })
    else await writeFile(file, rest, 'utf8')
  }
  return { path: file, installed: false }
}
