// Lancement de Claude CLI (Claude Code) dans le dépôt Git d'un projet, avec le prompt d'une tâche.
// macOS : un script .command est ouvert dans le Terminal (session interactive : l'utilisateur garde la main
// sur chaque action). Ailleurs : la commande (syntaxe sh) est renvoyée pour être collée dans un terminal — sous
// Windows, dans Git Bash (fourni par Git for Windows, que Claude Code utilise aussi) : la syntaxe sh garde chaque
// argument intact, ce que PowerShell 5.1 ne garantit pas pour un exécutable natif (guillemets du prompt).
import { execFile } from 'node:child_process'
import { constants, existsSync, readFileSync } from 'node:fs'
import { access, chmod, lstat, mkdir, stat, writeFile } from 'node:fs/promises'
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
 * Dossier du PATH digne de confiance pour chercher ou lancer Claude CLI (docs/SUITE.md §5.3) : absolu, et hors
 * des dossiers ajoutés par npm (node_modules/.bin, node-gyp-bin), qui imposeraient les outils d'Atelier_Projets
 * — ou d'un dépôt quelconque — à la place de la vraie CLI. Une entrée relative (« . », « bin ») dépend du dossier
 * courant : ignorée.
 */
export function trustedPathEntry(entry: string, platform: NodeJS.Platform = process.platform): boolean {
  const paths = platform === 'win32' ? path.win32 : path.posix
  return entry !== '' && paths.isAbsolute(entry) && !/[\\/]node_modules[\\/]\.bin[\\/]?$/.test(entry) && !/node-gyp-bin/.test(entry)
}

/** Dossiers retenus d'un PATH (ordre gardé, doublons retirés), voir trustedPathEntry(). */
export function searchDirs(searchPath: string | undefined, platform: NodeJS.Platform = process.platform): string[] {
  const delimiter = platform === 'win32' ? ';' : ':'
  return [...new Set((searchPath ?? '').split(delimiter).filter((entry) => trustedPathEntry(entry, platform)))]
}

/**
 * PATH transmis à Claude CLI (session dans un terminal ou appel isolé) : les dossiers retenus du PATH du backend
 * (searchDirs), précédés du dossier de l'exécutable (une CLI installée par npm doit trouver `node` depuis le Finder).
 */
export function sessionPath(searchPath: string | undefined, executable: string, platform: NodeJS.Platform = process.platform): string {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const own = paths.isAbsolute(executable) ? [paths.dirname(executable)] : []
  const fallback = platform === 'win32' ? '' : '/usr/bin:/bin'
  return [...new Set([...own, ...searchDirs(searchPath ?? fallback, platform)])].join(platform === 'win32' ? ';' : ':')
}

/** Commande donnée comme chemin relatif (« ./claude », « bin/claude ») : refusée, elle dépendrait du dossier courant. */
export function isRelativeCommand(command: string): boolean {
  return /[\\/]/.test(command) && !path.isAbsolute(command)
}

/** Message d'un CLAUDE_CLI relatif. */
export function relativeCommandMessage(command: string): string {
  return `CLAUDE_CLI doit être un chemin absolu (« ${command} » refusé)`
}

/**
 * Noms essayés pour une commande (docs/SUITE.md §9.6) : sous Windows, « claude » désigne claude.exe (installeur natif),
 * puis claude.cmd (installation npm, résolu ensuite par resolveClaudeLaunch en node.exe + cli.js) ; le script
 * « claude » sans extension posé par npm n'est pas exécutable. Un chemin absolu donné (CLAUDE_CLI) est essayé avec
 * « .exe », « .cmd », puis tel quel. Un .bat ou toute autre extension n'est jamais retenu.
 */
export function executableNames(command: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== 'win32') return [command]
  const extension = path.win32.extname(command).toLowerCase()
  if (extension === '.exe' || extension === '.cmd') return [command]
  if (extension !== '') return []
  return path.win32.isAbsolute(command) ? [`${command}.exe`, `${command}.cmd`, command] : [`${command}.exe`, `${command}.cmd`]
}

/** Lancement effectif de la CLI : exécutable et arguments placés avant ceux de Claude (node.exe + cli.js). */
export interface ClaudeLaunch {
  executable: string
  args: string[]
}

export interface ResolveLaunchOptions {
  platform?: NodeJS.Platform
  /** PATH où chercher node.exe quand il n'est pas à côté de claude.cmd. */
  searchPath?: string
  exists?: (file: string) => boolean
  readFile?: (file: string) => string
}

/**
 * Lancement d'un exécutable de Claude trouvé (docs/SUITE.md §9.6) : tel quel, sauf sous Windows un claude.cmd installé
 * par npm, résolu en `node.exe <dossier>\node_modules\@anthropic-ai\claude-code\<bin>` (bin du package.json, sinon
 * cli.js ; node.exe à côté du .cmd, sinon dans le PATH retenu). Non résolu → null : refusé. Jamais de cmd.exe, qui
 * réinterpréterait le prompt système et le schéma JSON passés en arguments.
 */
export function resolveClaudeLaunch(found: string, options: ResolveLaunchOptions = {}): ClaudeLaunch | null {
  const { platform = process.platform, exists = existsSync, readFile = (file: string) => readFileSync(file, 'utf8') } = options
  if (platform !== 'win32') return { executable: found, args: [] }
  const win = path.win32
  const extension = win.extname(found).toLowerCase()
  if (extension !== '.cmd') return { executable: found, args: [] }
  const dir = win.dirname(found)
  const packageDir = win.join(dir, 'node_modules', '@anthropic-ai', 'claude-code')
  let entry = 'cli.js'
  try {
    const bin = (JSON.parse(readFile(win.join(packageDir, 'package.json'))) as { bin?: unknown }).bin
    const declared = typeof bin === 'string' ? bin : typeof bin === 'object' && bin !== null ? (bin as Record<string, unknown>).claude : undefined
    if (typeof declared === 'string' && declared.trim() !== '') entry = declared
  } catch {
    /* package.json illisible : cli.js */
  }
  const script = win.resolve(packageDir, entry)
  // Le script reste dans le paquet, et c'est un fichier JavaScript lancé par node.exe.
  if (!script.toLowerCase().startsWith(`${packageDir.toLowerCase()}\\`) || !/\.(c|m)?js$/i.test(script) || !exists(script)) return null
  const nodeCandidates = [win.join(dir, 'node.exe'), ...searchDirs(options.searchPath, platform).map((entryDir) => win.join(entryDir, 'node.exe'))]
  const node = nodeCandidates.find((file) => exists(file))
  return node ? { executable: node, args: [script] } : null
}

/** Message d'un claude.cmd qui ne se résout pas en node.exe + cli.js. */
export function unresolvedCmdMessage(found: string): string {
  return `« ${found} » ne se résout pas en node.exe + cli.js de @anthropic-ai/claude-code : refusé (jamais lancé par cmd.exe) ; installer Claude Code avec son installateur (claude.exe) ou renseigner CLAUDE_CLI`
}

/**
 * Exécutable trouvé : chemin absolu donné tel quel, sinon nom cherché dans les dossiers retenus du PATH
 * (searchDirs). Un chemin relatif n'est jamais accepté. Renvoie toujours un chemin absolu, ou null.
 */
export async function findExecutable(command: string, searchPath: string | undefined): Promise<string | null> {
  if (isRelativeCommand(command)) return null
  const names = executableNames(command)
  const candidates = path.isAbsolute(command) ? names : searchDirs(searchPath).flatMap((dir) => names.map((name) => path.join(dir, name)))
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      if ((await stat(candidate)).isFile()) return candidate
    } catch {
      /* suivant */
    }
  }
  return null
}

/**
 * Dossiers où chercher Claude CLI après le PATH (docs/SUITE.md §5.3) : une application lancée depuis le Finder
 * n'hérite pas du PATH du terminal, et l'installeur de Claude Code place la CLI dans ~/.local/bin
 * (Windows : %USERPROFILE%\.local\bin\claude.exe).
 */
export function claudeFallbackDirs(home: string = homedir(), platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') return [path.win32.join(home, '.local', 'bin')]
  return [path.posix.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
}

/**
 * Exécutable de Claude CLI : chemin absolu donné (CLAUDE_CLI), sinon PATH — sans entrée relative ni
 * node_modules/.bin —, puis les dossiers habituels (~/.local/bin, /opt/homebrew/bin, /usr/local/bin).
 * null s'il est introuvable ou si CLAUDE_CLI est un chemin relatif.
 */
export async function findClaudeExecutable(
  command: string,
  searchPath: string | undefined,
  fallbackDirs: readonly string[] = claudeFallbackDirs(),
): Promise<string | null> {
  const found = await findExecutable(command, searchPath)
  if (found !== null || path.isAbsolute(command) || isRelativeCommand(command)) return found
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
  readVersion?: (executable: string, prefix?: readonly string[]) => Promise<string>
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
    (async (executable: string, prefix: readonly string[] = []) =>
      (await run(executable, [...prefix, '--version'], { timeout: 10_000, windowsHide: true })).stdout.trim())

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

  async function prepare(request: ClaudeSessionRequest): Promise<PreparedSession & { executable: string; invocation: string }> {
    const prompt = request.prompt === null ? null : request.prompt.trim()
    if (prompt === '') throw new Error('prompt vide')
    // Introuvable : la commande est renvoyée telle quelle (à coller dans un terminal), jamais un chemin relatif
    // qui serait résolu dans le dépôt du projet.
    if (isRelativeCommand(command)) throw new Error(relativeCommandMessage(command))
    const found = await locate()
    // Windows : claude.cmd de npm résolu en node.exe + cli.js, refusé s'il ne se résout pas (docs/SUITE.md §9.6).
    const launch = found === null ? { executable: command, args: [] } : resolveClaudeLaunch(found, { searchPath })
    if (launch === null) throw new Error(unresolvedCmdMessage(found ?? command))
    const executable = launch.executable
    const invocation = [launch.executable, ...launch.args].map(shellQuote).join(' ')
    await ensureWorkDir()
    let promptFile: string | null = null
    if (prompt !== null) {
      promptFile = path.join(workDir, `prompt-${request.workItemId ?? 'projet'}-${Date.now()}.md`)
      await writeFile(promptFile, `${prompt}\n`, { mode: 0o600, flag: 'wx' })
    }
    const sessionCommand = `cd -- ${shellQuote(request.cwd)} && ${invocation}${cliArguments(request.permissionMode, promptFile)}`
    return { command: sessionCommand, promptFile, executable, invocation }
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
          `exec ${prepared.invocation}${cliArguments(request.permissionMode, prepared.promptFile, '-- ')}`,
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
    if (isRelativeCommand(command)) return { ...base, available: false, version: null, error: relativeCommandMessage(command) }
    if (!executable) {
      return { ...base, available: false, version: null, error: `Claude CLI introuvable (« ${command} » absent du PATH, de ~/.local/bin, /opt/homebrew/bin et /usr/local/bin ; voir CLAUDE_CLI)` }
    }
    const launch = resolveClaudeLaunch(executable, { searchPath })
    if (launch === null) return { ...base, available: false, version: null, error: unresolvedCmdMessage(executable) }
    try {
      return { ...base, available: true, version: (await readVersion(launch.executable, launch.args)) || null, error: null }
    } catch {
      return { ...base, available: false, version: null, error: `« ${executable} --version » a échoué` }
    }
  }
}
