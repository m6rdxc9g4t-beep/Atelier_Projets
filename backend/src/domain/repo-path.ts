// Chemin du dépôt Git local d'un projet, tel qu'il est saisi : « ~/dev/x », entre guillemets (copié du Finder ou
// du terminal), avec une barre finale… Normalisé à l'enregistrement, pour qu'un chemin inutilisable soit refusé
// tout de suite et non à la première analyse. Module pur : l'existence du dossier n'est pas vérifiée ici
// (un dépôt pas encore cloné reste enregistrable).
import path from 'node:path'

export class RepoPathError extends Error {}

/**
 * Chemin absolu du dépôt : espaces et guillemets entourants retirés, « ~ » remplacé par le dossier personnel,
 * séparateurs finaux retirés. Un chemin déjà absolu reste identique. Lève RepoPathError pour un chemin relatif.
 * `api` : règles de chemin du système (path par défaut ; path.posix / path.win32 dans les tests).
 */
export function normalizeRepoPath(input: string, home: string, api: path.PlatformPath = path): string {
  let value = input.trim()
  const quote = value.charAt(0)
  if (value.length >= 2 && (quote === '"' || quote === "'") && value.endsWith(quote)) value = value.slice(1, -1).trim()

  if (value === '~') value = home
  else if (value.startsWith('~/') || value.startsWith(`~${api.sep}`)) value = api.join(home, value.slice(2))

  if (!api.isAbsolute(value)) {
    throw new RepoPathError(
      `Chemin du dépôt local : indiquez le chemin complet du dossier, par exemple « ${api.join(home, 'dev', 'mon-projet')} » ou « ~/dev/mon-projet » (reçu : « ${input.trim()} »)`,
    )
  }
  const { root } = api.parse(value)
  while (value.length > root.length && (value.endsWith('/') || value.endsWith(api.sep))) value = value.slice(0, -1)
  return value
}
