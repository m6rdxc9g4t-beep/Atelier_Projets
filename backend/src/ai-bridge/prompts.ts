// Prompts envoyés à l'IA locale (Ollama) et à Claude CLI, et lecture des réponses. Module pur, testable.
import type { ChatMessage } from './ollama.ts'

// --- Découpage d'une Story en Features / Tasks ------------------------------------------------------

export interface BreakdownContext {
  projectName: string
  hoursPerDay: number
  phase: { code: string; title: string }
  epic: { code: string; title: string; description: string }
  story: { code: string; title: string; description: string }
  existing: { id: number; type: string; title: string; estimateDays: number | null }[]
  instructions?: string
}

export interface ProposedWorkItem {
  type: 'FEATURE' | 'TASK'
  title: string
  description: string
  estimateDays: number
}

/** Bornes des propositions : au plus 12 éléments, de 0,25 à 10 jours chacun. */
export const BREAKDOWN_LIMITS = { maxItems: 12, minDays: 0.25, maxDays: 10, maxTitle: 200, maxDescription: 4000 } as const

/** Schéma JSON imposé à la réponse du modèle (sorties structurées d'Ollama). */
export const BREAKDOWN_FORMAT = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['FEATURE', 'TASK'] },
          title: { type: 'string' },
          description: { type: 'string' },
          estimateDays: { type: 'number' },
        },
        required: ['type', 'title', 'description', 'estimateDays'],
      },
    },
  },
  required: ['items'],
} as const

const BREAKDOWN_SYSTEM = `Tu es un chef de projet logiciel agile expérimenté. Tu découpes une User Story en éléments de travail concrets :
- FEATURE : une fonctionnalité visible ou un comportement nouveau ;
- TASK : une action technique (configuration, tests, migration, documentation…).
Règles :
- 3 à 8 éléments, sans doublon avec les éléments déjà présents dans la story ;
- titre court à l'infinitif ou nominal (moins de 80 caractères), en français ;
- description en Markdown : une phrase d'objectif puis 2 à 4 critères d'acceptation en cases à cocher « - [ ] » ;
- estimateDays : charge réaliste en jours de travail (1 jour = {HOURS} heures), multiple de 0,25, entre 0,25 et 5 ;
- réponds uniquement avec l'objet JSON demandé.`

function block(label: string, text: string): string {
  const trimmed = text.trim()
  return trimmed === '' ? '' : `\n${label} :\n${trimmed}\n`
}

export function buildBreakdownMessages(context: BreakdownContext): ChatMessage[] {
  const existing =
    context.existing.length === 0
      ? 'aucun'
      : context.existing
          .map((item) => `- #${item.id} ${item.type} « ${item.title} »${item.estimateDays === null ? '' : ` (${item.estimateDays} j)`}`)
          .join('\n')
  const user = [
    `Projet : ${context.projectName}`,
    `PHASE ${context.phase.code} : ${context.phase.title}`,
    `EPIC ${context.epic.code} : ${context.epic.title}`,
    block('Description de l’epic', context.epic.description),
    `STORY ${context.story.code} : ${context.story.title}`,
    block('Description de la story', context.story.description),
    `Éléments déjà présents dans la story :\n${existing}`,
    block('Consignes complémentaires', context.instructions ?? ''),
    'Propose le découpage de cette story.',
  ]
    .filter((line) => line !== '')
    .join('\n')
  return [
    { role: 'system', content: BREAKDOWN_SYSTEM.replace('{HOURS}', String(context.hoursPerDay)) },
    { role: 'user', content: user },
  ]
}

/** Extrait l'objet JSON d'une réponse (tolère un bloc ```json … ``` ou du texte autour). */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = (fenced?.[1] ?? text).trim()
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1))
      } catch {
        return undefined
      }
    }
    return undefined
  }
}

/**
 * Propositions valides tirées de la réponse du modèle : types FEATURE / TASK uniquement, titres non vides et
 * sans doublon (ni entre eux, ni avec les éléments existants), estimations arrondies au quart de jour et bornées.
 * null si la réponse n'est pas exploitable.
 */
export function parseBreakdown(text: string, existingTitles: readonly string[] = []): ProposedWorkItem[] | null {
  const parsed = extractJson(text)
  const rawItems = Array.isArray(parsed) ? parsed : (parsed as { items?: unknown } | undefined)?.items
  if (!Array.isArray(rawItems)) return null
  const seen = new Set(existingTitles.map((title) => normalizeTitle(title)))
  const items: ProposedWorkItem[] = []
  for (const raw of rawItems) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>
    const type = String(entry.type ?? '').trim().toUpperCase()
    if (type !== 'FEATURE' && type !== 'TASK') continue
    const title = String(entry.title ?? '').replace(/\s+/g, ' ').trim().slice(0, BREAKDOWN_LIMITS.maxTitle)
    if (title === '' || seen.has(normalizeTitle(title))) continue
    seen.add(normalizeTitle(title))
    const estimate = Number(String(entry.estimateDays ?? '').replace(',', '.'))
    const estimateDays = Number.isFinite(estimate)
      ? Math.min(BREAKDOWN_LIMITS.maxDays, Math.max(BREAKDOWN_LIMITS.minDays, Math.round(estimate * 4) / 4))
      : 1
    const description = typeof entry.description === 'string' ? entry.description.trim().slice(0, BREAKDOWN_LIMITS.maxDescription) : ''
    items.push({ type, title, description, estimateDays })
    if (items.length === BREAKDOWN_LIMITS.maxItems) break
  }
  return items.length > 0 ? items : null
}

function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// --- Résumé des commits pour le journal d'avancement -----------------------------------------------

export interface SummaryCommit {
  shortHash: string
  committedAt: string
  authorName: string
  message: string
  /** Diff (stat + patch) éventuellement tronqué, ou null si indisponible. */
  patch: string | null
}

export interface SummaryContext {
  item: { id: number; type: string; title: string; description: string; implementationLog: string }
  commits: SummaryCommit[]
}

const SUMMARY_SYSTEM = `Tu es un développeur senior qui tient le « Journal d'avancement » d'une tâche : il explique COMMENT le travail a été réalisé techniquement.
À partir des commits et de leurs diffs, rédige en français une nouvelle entrée du journal :
- 120 à 250 mots, en Markdown simple (paragraphes courts ou liste à puces), sans titre ni date ;
- décris les changements réels : fichiers ou modules touchés, choix techniques, tests ajoutés, points d'attention ;
- cite les hash courts des commits entre backticks quand c'est utile ;
- ne répète pas l'entrée précédente du journal et n'invente rien qui ne figure pas dans les commits.`

export function buildSummaryMessages(context: SummaryContext): ChatMessage[] {
  const { item } = context
  const commits = context.commits
    .map((commit) =>
      [
        `### Commit ${commit.shortHash} — ${commit.committedAt} — ${commit.authorName}`,
        commit.message.trim(),
        commit.patch === null ? '(diff indisponible : commit absent du dépôt local)' : `\`\`\`diff\n${commit.patch}\n\`\`\``,
      ].join('\n'),
    )
    .join('\n\n')
  const previous = item.implementationLog.trim()
  const user = [
    `Élément : ${item.type} #${item.id} — ${item.title}`,
    block('Description (ce qu’il fallait faire)', item.description.slice(0, 3000)),
    block('Fin du journal actuel', previous.length > 1500 ? `…${previous.slice(-1500)}` : previous),
    `Commits liés (du plus ancien au plus récent) :\n\n${commits}`,
  ]
    .filter((line) => line !== '')
    .join('\n')
  return [
    { role: 'system', content: SUMMARY_SYSTEM },
    { role: 'user', content: user },
  ]
}

/** Nettoie le texte produit : sans bloc de code englobant, sans titre ni ligne vide superflue. */
export function cleanSummary(text: string): string {
  let result = text.trim()
  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(result)
  if (fenced?.[1]) result = fenced[1].trim()
  result = result.replace(/^#{1,6} .*\n+/, '')
  return result.replace(/\n{3,}/g, '\n\n').trim()
}

// --- Prompt de Claude CLI ------------------------------------------------------------------------------

export interface ClaudePromptContext {
  item: { id: number; type: string; title: string; status: string; description: string; implementationLog: string }
  path: { phase: string; epic: string; story: string }
  commits: { shortHash: string; message: string }[]
}

/** Type de commit conventionnel (CLAUDE.md §4 : « feat(scope): description #ID »). */
const COMMIT_TYPE: Record<string, string> = { FEATURE: 'feat', TASK: 'chore', BUG: 'fix' }

/** Prompt initial d'une session Claude CLI ouverte dans le dépôt du projet pour réaliser l'élément. */
export function buildClaudePrompt(context: ClaudePromptContext): string {
  const { item } = context
  const commitType = COMMIT_TYPE[item.type] ?? 'feat'
  const lines = [
    `Tâche ${item.type} #${item.id} — ${item.title}`,
    `Contexte : ${context.path.phase} › ${context.path.epic} › ${context.path.story} (statut actuel : ${item.status})`,
    '',
    '## Ce qu’il faut faire',
    item.description.trim() || '(pas de description : commence par la préciser avec moi)',
  ]
  const log = item.implementationLog.trim()
  if (log !== '') lines.push('', '## Journal d’avancement (déjà réalisé)', log.length > 3000 ? `…${log.slice(-3000)}` : log)
  if (context.commits.length > 0) {
    lines.push('', '## Commits déjà liés', ...context.commits.slice(0, 15).map((commit) => `- ${commit.shortHash} ${commit.message.split('\n')[0]}`))
  }
  lines.push(
    '',
    '## Consignes',
    '- Lis d’abord CLAUDE.md et README.md s’ils existent, et respecte leurs règles.',
    '- Propose un plan court avant de modifier le code, puis avance par étapes vérifiées (compilation, tests).',
    `- Messages de commit : « ${commitType}(scope): description #${item.id} », pour que chaque commit soit rattaché automatiquement à la tâche.`,
  )
  return lines.join('\n')
}
