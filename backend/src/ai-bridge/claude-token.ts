// Jeton du forfait Claude (`claude setup-token`) : lu une fois, jamais montré (docs/SUITE.md §5.3, mode jeton).
//
// Décision de l'utilisateur : « je veux que Claude forfait cli soit actif car c'est personnel ça sera mon forfait
// Claude ». Sur un serveur, il n'y a pas de session `claude` connectée : le moteur Claude (claude-print.ts, mêmes
// drapeaux d'isolation) s'authentifie avec le jeton d'un an que `claude setup-token` affiche, fourni au processus par
// la variable d'environnement CLAUDE_OAUTH_TOKEN (même nom dans toutes les applications de la suite).
// - Lu une seule fois, au démarrage (captureClaudeToken, avant tout sous-processus), puis retiré de l'environnement du
//   processus : ni git, ni la session Claude du terminal, ni aucun autre enfant n'en hérite. Seule la CLI isolée le
//   reçoit, sous le nom CLAUDE_CODE_OAUTH_TOKEN, dans son environnement (jamais en argument).
// - Lu dans l'environnement seulement, jamais dans backend/.env ; écrit nulle part ; absent des réponses, des erreurs
//   (scrubToken) et des journaux (ClaudeToken ne se sérialise pas).
// - Sans cette variable, rien ne change (session `claude auth login` de l'utilisateur).
import { chmod, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

/** Variable lue par l'application (la même dans toutes les applications de la suite). */
export const CLAUDE_TOKEN_ENV = 'CLAUDE_OAUTH_TOKEN'
/** Variable que lit la CLI Claude Code : posée dans SON environnement seulement. */
export const CLAUDE_CLI_TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN'
/** Dossier privé de la CLI en mode jeton (HOME ; CLAUDE_CONFIG_DIR = son .claude), sous le dossier de données. */
export const CLAUDE_PRIVATE_HOME = 'claude-forfait'
/** Remplace le jeton dans tout texte montré. */
export const TOKEN_MASK = '[jeton masqué]'
/** Forme des jetons d'Anthropic (forfait sk-ant-oat…, clé sk-ant-api…) : masquée même si ce n'est pas le nôtre. */
const TOKEN_SHAPE = /sk-ant-[A-Za-z0-9_-]{8,}/g

/** Jeton gardé en mémoire : sa valeur ne sort que par reveal(), jamais par String(), JSON ou un journal. */
export class ClaudeToken {
  readonly #value: string

  constructor(value: string) {
    this.#value = value
  }

  /** La valeur du jeton, pour l'environnement de la CLI seulement. */
  reveal(): string {
    return this.#value
  }

  toString(): string {
    return 'ClaudeToken(***)'
  }

  toJSON(): string {
    return 'ClaudeToken(***)'
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return 'ClaudeToken(***)'
  }
}

/**
 * Lit CLAUDE_OAUTH_TOKEN et le retire de `env` (toutes les casses : Windows). Vide ou absent → null.
 * À appeler une seule fois au démarrage, avant tout sous-processus et avant loadEnvFile().
 */
export function captureClaudeToken(env: NodeJS.ProcessEnv = process.env): ClaudeToken | null {
  let raw = ''
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() !== CLAUDE_TOKEN_ENV) continue
    raw ||= env[key]?.trim() ?? ''
    delete env[key]
  }
  return raw === '' ? null : new ClaudeToken(raw)
}

/** Le texte sans le jeton, ni rien qui ait la forme d'un jeton d'Anthropic. */
export function scrubToken(text: string, token: ClaudeToken | null = null): string {
  const value = token?.reveal()
  const withoutToken = value ? text.split(value).join(TOKEN_MASK) : text
  return withoutToken.replace(TOKEN_SHAPE, TOKEN_MASK)
}

/** Dossier privé de la CLI en mode jeton, en chemin absolu, sous le dossier de données de l'application. */
export function claudePrivateHome(dataDir: string): string {
  return path.resolve(dataDir, CLAUDE_PRIVATE_HOME)
}

/** Crée le dossier privé et son .claude (droits 700 hors Windows) ; rend le dossier de configuration de la CLI. */
export async function ensurePrivateHome(home: string): Promise<string> {
  const config = path.join(home, '.claude')
  for (const folder of [home, config]) {
    await mkdir(folder, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32' && ((await stat(folder)).mode & 0o777) !== 0o700) await chmod(folder, 0o700)
  }
  return config
}
