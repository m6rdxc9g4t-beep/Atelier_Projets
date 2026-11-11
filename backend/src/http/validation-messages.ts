// Messages en français pour les erreurs de validation des requêtes (Ajv), à la place du message technique
// (« body/hours must be <= 24 », « body/githubRepo must match pattern "^[A-Za-z0-9._-]{1,100}$" ») qui ne dit
// pas quoi corriger. Sert à l'interface et au `detail` du nœud Atelier (docs/SUITE.md §7.5).
// Module pur : testé sans base de données.

export interface ValidationIssue {
  instancePath?: string
  keyword?: string
  /** Paramètres d'Ajv : `limit`, `missingProperty`, `additionalProperty`, `allowedValues`, `type`, `format`, `pattern`. */
  params?: Record<string, unknown>
}

/** Libellés des champs, tels que l'interface les nomme (camelCase de l'API, snake_case du nœud Atelier). */
const FIELD_LABELS: Record<string, string> = {
  title: 'Titre',
  name: 'Nom',
  label: 'Libellé',
  description: 'Description',
  implementationLog: 'Journal d’avancement',
  text: 'Texte',
  comment: 'Commentaire',
  hours: 'Heures',
  days: 'Jours',
  estimatedHours: 'Estimation (heures)',
  estimated_hours: 'Estimation (heures)',
  estimatedDays: 'Estimation (jours)',
  estimated_days: 'Estimation (jours)',
  budgetHours: 'Budget (heures)',
  budgetDays: 'Budget (jours)',
  hoursPerDay: '« 1 jour = X heures »',
  spentOn: 'Date de la saisie',
  spent_on: 'Date de la saisie',
  startDate: 'Date de début',
  start_date: 'Date de début',
  dueDate: 'Échéance',
  due_date: 'Échéance',
  date: 'Date',
  reachedAt: 'Date d’atteinte',
  reached_at: 'Date d’atteinte',
  status: 'Statut',
  type: 'Type',
  priority: 'Priorité',
  progress: 'Avancement',
  position: 'Position',
  slug: 'Identifiant du projet',
  defaultBranch: 'Branche par défaut',
  localRepoPath: 'Chemin du dépôt local',
  githubOwner: 'Propriétaire GitHub',
  githubRepo: 'Dépôt GitHub',
  model: 'Modèle',
  engine: 'Moteur',
  claudeModel: 'Modèle Claude',
  prompt: 'Prompt',
  items: 'Liste des éléments',
  projectId: 'Projet',
  project_id: 'Projet',
  phaseId: 'Phase',
  epicId: 'Epic',
  storyId: 'Story',
  story_id: 'Story',
  workItemId: 'Élément',
  work_item_id: 'Élément',
  predecessorId: 'Prédécesseur',
  successorId: 'Successeur',
  limit: 'Limite',
  q: 'Recherche',
}

/** Champs dont le format mérite une explication (motif refusé). */
const PATTERN_HINTS: Record<string, string> = {
  githubOwner:
    'Propriétaire GitHub : indiquez seulement le nom d’utilisateur ou d’organisation (lettres, chiffres et « - »), par exemple « octocat ».',
  githubRepo:
    'Dépôt GitHub : indiquez seulement le nom du dépôt (lettres, chiffres, « . », « _ » et « - »), par exemple « atelier-tab », sans l’adresse ni le propriétaire.',
  slug: 'Identifiant du projet : minuscules, chiffres et tirets seulement, par exemple « refonte-site ».',
}

const TYPE_NAMES: Record<string, string> = {
  string: 'texte',
  number: 'nombre',
  integer: 'nombre entier',
  boolean: 'vrai ou faux',
  array: 'liste',
  object: 'objet',
  null: 'valeur vide',
}

const FORMAT_HINTS: Record<string, string> = {
  date: 'date attendue au format AAAA-MM-JJ',
  'date-time': 'date et heure attendues au format ISO 8601 (2026-10-18T14:30:00Z)',
}

/** Au-delà, la liste des valeurs admises n'aide plus : elle est coupée. */
const MAX_LISTED_VALUES = 12

const quoted = (name: string): string => `« ${name} »`
const labelOf = (name: string): string => FIELD_LABELS[name] ?? quoted(name)
/** Nombre écrit à la française (virgule décimale). */
const number = (value: unknown): string => String(value).replace('.', ',')
const plural = (count: unknown, word: string): string => `${number(count)} ${word}${Number(count) > 1 ? 's' : ''}`

/** Champ visé par l'erreur : dernier segment nommé du chemin, et rang dans une liste (« /items/1/title » → ligne 2). */
function target(instancePath: string | undefined): { field: string | undefined; label: string } {
  const segments = (instancePath ?? '').split('/').filter(Boolean)
  const field = segments.findLast((segment) => !/^\d+$/.test(segment))
  if (field === undefined) return { field, label: 'Requête' }
  const index = segments.find((segment) => /^\d+$/.test(segment))
  return { field, label: index === undefined ? labelOf(field) : `${labelOf(field)} (ligne ${Number(index) + 1})` }
}

/** Ce qui ne va pas, sans le nom du champ ; null pour un mot-clé non prévu. */
function reason(issue: ValidationIssue, field: string | undefined): string | null {
  const params = issue.params ?? {}
  const { limit } = params
  switch (issue.keyword) {
    case 'maximum':
      return limit === undefined ? null : `${number(limit)} au plus`
    case 'minimum':
      return limit === undefined ? null : `${number(limit)} au moins`
    case 'exclusiveMinimum':
      return limit === undefined ? null : `doit être supérieur à ${number(limit)}`
    case 'exclusiveMaximum':
      return limit === undefined ? null : `doit être inférieur à ${number(limit)}`
    case 'maxLength':
      return limit === undefined ? null : `${plural(limit, 'caractère')} au plus`
    case 'minLength':
      if (limit === undefined) return null
      return Number(limit) <= 1 ? 'ne peut pas être vide' : `${plural(limit, 'caractère')} au moins`
    case 'maxItems':
      return limit === undefined ? null : `${plural(limit, 'élément')} au plus`
    case 'minItems':
      return limit === undefined ? null : `${plural(limit, 'élément')} au moins`
    case 'type': {
      const types = (Array.isArray(params.type) ? params.type : [params.type]).filter((type) => type !== 'null')
      const names = types.map((type) => TYPE_NAMES[String(type)])
      return names.length === 0 || names.includes(undefined) ? null : `${names.join(' ou ')} attendu`
    }
    case 'enum': {
      const values = Array.isArray(params.allowedValues) ? params.allowedValues.filter((value) => value !== null) : []
      if (values.length === 0) return 'valeur non reconnue'
      const listed = values.slice(0, MAX_LISTED_VALUES).join(', ')
      return `valeur non reconnue (attendu : ${listed}${values.length > MAX_LISTED_VALUES ? '…' : ''})`
    }
    case 'format':
      return FORMAT_HINTS[String(params.format)] ?? null
    case 'pattern':
      // « \S » : au moins un caractère visible (titres, textes).
      return params.pattern === '\\S' ? 'ne peut pas être vide' : field === undefined ? null : 'format non reconnu'
    default:
      return null
  }
}

/**
 * Message de la première erreur de validation, en français (« Heures : 24 au plus. ») ; `fallback` (message
 * d'Ajv) pour un mot-clé non prévu.
 */
export function validationMessage(issues: readonly ValidationIssue[] | undefined, fallback: string): string {
  const first = issues?.[0]
  if (!first) return fallback
  const params = first.params ?? {}
  if (first.keyword === 'required' && typeof params.missingProperty === 'string') {
    return `${labelOf(params.missingProperty)} : champ obligatoire.`
  }
  if (first.keyword === 'additionalProperties' && typeof params.additionalProperty === 'string') {
    return `Champ inconnu : ${quoted(params.additionalProperty)}.`
  }
  const { field, label } = target(first.instancePath)
  if (first.keyword === 'pattern' && field !== undefined && PATTERN_HINTS[field]) return PATTERN_HINTS[field]
  const detail = reason(first, field)
  return detail === null ? fallback : `${label} : ${detail}.`
}
