// Lancement de Claude CLI (Claude Code) dans le dépôt Git d'un projet, avec le prompt d'une tâche.
// macOS : un script .command est ouvert dans le Terminal (session interactive : l'utilisateur garde la main
// sur chaque action). Ailleurs : la commande est renvoyée pour être collée dans un terminal.
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, chmod, lstat, mkdir, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const CLAUDE_PERMISSION_MODES = ['default', 'plan', 'acceptEdits'] as const
export type ClaudePermissionMode = (typeof CLAUDE_PERMISSION_MODES)[number]

export interface ClaudeCliStatus {
  available: boolean
  version: string | null
  /** Chemin de l'exécutable trouvé, ou la commande configurée. */
  command: string
  /** Ouverture automatique d'un terminal possible (macOS). */
  canOpenTerminal: boolean
  terminalApp: string | null
  error: string | null
}

export interface ClaudeSessionRequest {
  /** Élément concerné (nom des fichiers), ou null pour une session sur le projet. */
  workItemId: number | null
  /** Racine du dépôt Git du projet (dossier de travail de la session). */
  cwd: string
  /** Prompt initial ; null : session interactive sans prompt. */
  prompt: string | null
  permissionMode: ClaudePermissionMode
}

export interface PreparedSession {
  /** Commande à exécuter dans un terminal (le prompt est lu dans promptFile). */
  command: string
  promptFile: string | null
}

export interface ClaudeLauncher {
  status(): Promise<ClaudeCliStatus>
  /** Écrit le prompt dans un fichier temporaire et renvoie la commande qui ouvre la session. */
  prepare(request: ClaudeSessionRequest): Promise<PreparedSession>
  /** Ouvre la session dans un terminal (macOS) ; launched = false ailleurs (commande à copier). */
  launch(request: ClaudeSessionRequest): Promise<PreparedSession & { launched: boolean }>
}

/** Argument shell entre apostrophes (sh, bash, zsh). */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * PATH transmis à la session : celui du backend sans les dossiers ajoutés par npm (node_modules/.bin,
 * node-gyp-bin), qui imposeraient les outils d'Atelier_Projets dans un autre dépôt ; le dossier de Claude CLI
 * est placé en tête.
 */
export function sessionPath(searchPath: string | undefined, executable: string): string {
  const entries = (searchPath ?? '/usr/bin:/bin')
    .split(path.delimiter)
    .filter((entry) => entry !== '' && !/[\\/]node_modules[\\/]\.bin$/.test(entry) && !/node-gyp-bin/.test(entry))
  const own = path.isAbsolute(executable) ? [path.dirname(executable)] : []
  return [...new Set([...own, ...entries])].join(path.delimiter)
}

/** Exécutable trouvé dans le PATH (ou chemin donné tel quel), sinon null. */
export async function findExecutable(command: string, searchPath: string | undefined): Promise<string | null> {
  const candidates = command.includes('/')
    ? [command]
    : (searchPath ?? '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, command))
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      /* suivant */
    }
  }
  return null
}

/**
 * Dossiers où chercher Claude CLI après le PATH (docs/SUITE.md §5.3) : une application lancée depuis le Finder
 * n'hérite pas du PATH du terminal, et l'installeur de Claude Code place la CLI dans ~/.local/bin.
 */
export function claudeFallbackDirs(home: string = homedir()): string[] {
  return [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
}

/**
 * Exécutable de Claude CLI : chemin donné (CLAUDE_CLI avec « / »), sinon PATH, puis les dossiers habituels
 * (~/.local/bin, /opt/homebrew/bin, /usr/local/bin). null s'il est introuvable.
 */
export async function findClaudeExecutable(
  command: string,
  searchPath: string | undefined,
  fallbackDirs: readonly string[] = claudeFallbackDirs(),
): Promise<string | null> {
  const found = await findExecutable(command, searchPath)
  if (found !== null || command.includes('/')) return found
  return findExecutable(command, fallbackDirs.join(path.delimiter))
}

export interface ClaudeLauncherOptions {
  /** Commande ou chemin de Claude CLI (CLAUDE_CLI, défaut « claude »). */
  command?: string
  /** Dossiers essayés après le PATH (défaut : claudeFallbackDirs()). */
  fallbackDirs?: readonly string[]
  /** Application de terminal macOS (CLAUDE_TERMINAL_APP, défaut « Terminal », ex. « iTerm »). */
  terminalApp?: string
  platform?: NodeJS.Platform
  /** PATH utilisé pour trouver Claude CLI et transmis à la session. */
  searchPath?: string
  /** Dossier des fichiers de prompt et des scripts. */
  workDir?: string
  /** Ouverture d'un fichier par une application (macOS : open -a), remplaçable dans les tests. */
  openWith?: (app: string, file: string) => Promise<void>
  /** Version de la CLI (claude --version), remplaçable dans les tests. */
  readVersion?: (executable: string) => Promise<string>
}

export function createClaudeLauncher(options: ClaudeLauncherOptions = {}): ClaudeLauncher {
  const command = options.command?.trim() || 'claude'
  const platform = options.platform ?? process.platform
  const terminalApp = platform === 'darwin' ? options.terminalApp?.trim() || 'Terminal' : null
  const searchPath = options.searchPath ?? process.env.PATH
  const fallbackDirs = options.fallbackDirs ?? claudeFallbackDirs()
  const locate = () => findClaudeExecutable(command, searchPath, fallbackDirs)
  // Dossier propre à l'utilisateur (sur Linux, /tmp est partagé) ; vérifié avant chaque écriture.
  const workDir = options.workDir ?? path.join(tmpdir(), `atelier-projets-claude-${process.getuid?.() ?? 'user'}`)
  const openWith =
    options.openWith ??
    (async (app: string, file: string) => {
      await run('open', ['-a', app, file], { timeout: 10_000 })
    })
  const readVersion =
    options.readVersion ??
    (async (executable: string) => (await run(executable, ['--version'], { timeout: 10_000 })).stdout.trim())

  let cachedStatus: { at: number; value: ClaudeCliStatus } | null = null

  /** Dossier de travail : créé au besoin, refusé s'il est un lien ou appartient à un autre utilisateur. */
  async function ensureWorkDir(): Promise<void> {
    await mkdir(workDir, { recursive: true, mode: 0o700 })
    const info = await lstat(workDir)
    const uid = process.getuid?.()
    if (!info.isDirectory() || info.isSymbolicLink() || (uid !== undefined && info.uid !== uid)) {
      throw new Error(`dossier temporaire « ${workDir} » non sûr (lien ou autre propriétaire)`)
    }
    await chmod(workDir, 0o700)
  }

  /** Arguments de la CLI ; « -- » : le prompt n'est jamais lu comme une option, même s'il commence par « - ». */
  function cliArguments(permissionMode: ClaudePermissionMode, promptFile: string | null, catOptions = ''): string {
    const mode = permissionMode === 'default' ? '' : ` --permission-mode ${permissionMode}`
    return promptFile === null ? mode : `${mode} -- "$(cat ${catOptions}${shellQuote(promptFile)})"`
  }

  async function prepare(request: ClaudeSessionRequest): Promise<PreparedSession & { executable: string }> {
    const prompt = request.prompt === null ? null : request.prompt.trim()
    if (prompt === '') throw new Error('prompt vide')
    const executable = (await locate()) ?? command
    await ensureWorkDir()
    let promptFile: string | null = null
    if (prompt !== null) {
      promptFile = path.join(workDir, `prompt-${request.workItemId ?? 'projet'}-${Date.now()}.md`)
      await writeFile(promptFile, `${prompt}\n`, { mode: 0o600, flag: 'wx' })
    }
    const sessionCommand = `cd -- ${shellQuote(request.cwd)} && ${shellQuote(executable)}${cliArguments(request.permissionMode, promptFile)}`
    return { command: sessionCommand, promptFile, executable }
  }

  return {
    async status() {
      // La version change rarement : 30 s de cache évitent de relancer « claude --version » à chaque affichage.
      if (cachedStatus && Date.now() - cachedStatus.at < 30_000) return cachedStatus.value
      const value = await readStatus()
      cachedStatus = { at: Date.now(), value }
      return value
    },

    async prepare(request) {
      const { command: sessionCommand, promptFile } = await prepare(request)
      return { command: sessionCommand, promptFile }
    },

    async launch(request) {
      const prepared = await prepare(request)
      const result = { command: prepared.command, promptFile: prepared.promptFile }
      if (terminalApp === null) return { ...result, launched: false }
      const script = path.join(workDir, `claude-${request.workItemId ?? 'projet'}-${Date.now()}.command`)
      await writeFile(
        script,
        [
          '#!/bin/zsh',
          `# Atelier_Projets — session Claude CLI ${request.workItemId === null ? 'sur le projet' : `pour l’élément #${request.workItemId}`}`,
          `export PATH=${shellQuote(sessionPath(searchPath, prepared.executable))}`,
          `cd -- ${shellQuote(request.cwd)} || exit 1`,
          `exec ${shellQuote(prepared.executable)}${cliArguments(request.permissionMode, prepared.promptFile, '-- ')}`,
          '',
        ].join('\n'),
        { mode: 0o700, flag: 'wx' },
      )
      await chmod(script, 0o700)
      await openWith(terminalApp, script)
      return { ...result, launched: true }
    },
  }

  async function readStatus(): Promise<ClaudeCliStatus> {
    const executable = await locate()
    const base = { command: executable ?? command, canOpenTerminal: terminalApp !== null, terminalApp }
    if (!executable) {
      return { ...base, available: false, version: null, error: `Claude CLI introuvable (« ${command} » absent du PATH, de ~/.local/bin, /opt/homebrew/bin et /usr/local/bin ; voir CLAUDE_CLI)` }
    }
    try {
      return { ...base, available: true, version: (await readVersion(executable)) || null, error: null }
    } catch {
      return { ...base, available: false, version: null, error: `« ${executable} --version » a échoué` }
    }
  }
}
