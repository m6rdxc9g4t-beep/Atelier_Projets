// Messages en français pour les erreurs de validation des corps de requête (Ajv), là où le message
// technique (« body/githubRepo must match pattern "^[A-Za-z0-9._-]{1,100}$" ») ne dit pas quoi corriger.
// Module pur : testé sans base de données.

export interface ValidationIssue {
  instancePath?: string
  keyword?: string
}

/** Champs dont le format mérite une explication (motif refusé). */
const PATTERN_HINTS: Record<string, string> = {
  githubOwner:
    'Propriétaire GitHub : indiquez seulement le nom d’utilisateur ou d’organisation (lettres, chiffres et « - »), par exemple « octocat ».',
  githubRepo:
    'Dépôt GitHub : indiquez seulement le nom du dépôt (lettres, chiffres, « . », « _ » et « - »), par exemple « atelier-tab », sans l’adresse ni le propriétaire.',
}

/** Message de l'erreur de validation : explication en français si elle existe, sinon `fallback`. */
export function validationMessage(issues: readonly ValidationIssue[] | undefined, fallback: string): string {
  const first = issues?.[0]
  if (first?.keyword !== 'pattern') return fallback
  const field = (first.instancePath ?? '').split('/').filter(Boolean).at(-1)
  return (field !== undefined && PATTERN_HINTS[field]) || fallback
}
