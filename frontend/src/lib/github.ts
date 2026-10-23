// Dépôt GitHub collé dans un champ du formulaire de projet : adresse du navigateur, adresse de clonage
// ou « propriétaire/dépôt » sont découpés en propriétaire + nom de dépôt, les deux seuls formats que
// l'API accepte.

export interface GithubRef {
  owner: string
  repo: string
}

const PATTERNS = [
  // https://github.com/owner/repo(.git)(/tree/main…)(?…)(#…)
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s?#]+)\/([^/\s?#]+)/i,
  // git@github.com:owner/repo.git
  /^git@github\.com:([^/\s]+)\/([^/\s]+)$/i,
  // owner/repo
  /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)$/,
]

/** Propriétaire + dépôt reconnus dans `value`, ou null si ce n'est pas une référence complète. */
export function splitGithubRef(value: string): GithubRef | null {
  const text = value.trim()
  for (const pattern of PATTERNS) {
    const match = pattern.exec(text)
    if (!match?.[1] || !match[2]) continue
    const repo = match[2].replace(/\.git$/i, '')
    if (repo) return { owner: match[1], repo }
  }
  return null
}

/**
 * Nouvelle valeur des deux champs quand l'un d'eux change : une référence complète remplit les deux,
 * une simple saisie ne touche que le champ modifié.
 */
export function withGithubInput<T extends { githubOwner: string; githubRepo: string }>(
  form: T,
  field: 'githubOwner' | 'githubRepo',
  value: string,
): T {
  const ref = splitGithubRef(value)
  return ref ? { ...form, githubOwner: ref.owner, githubRepo: ref.repo } : { ...form, [field]: value }
}
