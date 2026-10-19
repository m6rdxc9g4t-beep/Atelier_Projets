// Import DataFlow v2.1.0 depuis Atelier Tab (docs/SUITE.md §4.1) : lecture de l'enveloppe, correspondance
// des statuts (§1.4) et plan d'import (titre, statut, dates, description Markdown) — sans base ni HTTP.
// Le contrat de l'enveloppe est décrit dans docs/DATAFLOW_SPEC.md d'Atelier Tab ; il est reproduit ici
// (aucun import entre dépôts) et validé par le schéma TypeBox de src/schemas/atelier-tab.ts.
import { parseDateOnly } from './dates.ts'
import { WORK_ITEM_STATUSES, type WorkItemStatus } from './workflow.ts'

export const ATELIER_TAB_SCHEMA_VERSION = '2.1.0'
/** Phase qui range les éléments importés (retrouvée par son titre, créée au besoin). */
export const IMPORT_PHASE_TITLE = 'Imports Atelier Tab'
/** Préfixe de WorkItem.externalRef pour les éléments venus d'Atelier Tab. */
export const EXTERNAL_REF_PREFIX = 'atelier-tab'

const MAX_TITLE_LENGTH = 200
const DEFAULT_MAX_DESCRIPTION_LENGTH = 100_000

export const ATELIER_MAPPINGS = [
  'entity_title',
  'workflow_state',
  'financial_ht',
  'financial_ttc',
  'assignee',
  'due_date',
  'start_date',
  'quantity',
  'description',
  'flag',
  'custom',
] as const
export type AtelierMapping = (typeof ATELIER_MAPPINGS)[number]

export const ATELIER_COLUMN_TYPES = ['text', 'number', 'currency', 'percent', 'select', 'date', 'checkbox', 'owner', 'formula'] as const

export interface DataflowCell {
  raw: string
  computed: number | string | boolean | null
}

export interface DataflowColumn {
  col_letter: string
  id: string
  label: string
  type: string
  atelier_mapping: string
}

export interface DataflowRecord {
  row_index: number
  record_id: string
  values: Record<string, DataflowCell | undefined>
}

export interface DataflowEnvelope {
  schema_version: string
  workspace: { id: string; name: string }
  project: {
    id: string
    name: string
    source_table?: { id: string; name: string }
    columns_schema: DataflowColumn[]
    records: DataflowRecord[]
  }
}

// --- Statuts (§1.4) --------------------------------------------------------------------------------

/** Texte comparable : sans accents, en minuscules, « _ », « - » et espaces réduits à une espace. */
export function normalizeLabel(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim()
}

/** Libellés français officiels des 8 statuts (identiques dans les trois applications). */
export const STATUS_LABELS: Record<WorkItemStatus, string> = {
  OPEN: 'À faire',
  IN_PROGRESS: 'En cours',
  IN_REVIEW: 'En revue',
  ON_HOLD: 'En attente',
  BLOCKED: 'Bloquée',
  RESOLVED: 'Résolue',
  CLOSED: 'Terminée',
  REJECTED: 'Rejetée',
}

/** Synonymes acceptés à l'import, en plus des codes et des libellés. */
export const STATUS_SYNONYMS: Record<string, WorkItemStatus> = {
  Ouvert: 'OPEN',
  Nouveau: 'OPEN',
  Fait: 'CLOSED',
  Terminé: 'CLOSED',
  Clos: 'CLOSED',
  Bloqué: 'BLOCKED',
  Résolu: 'RESOLVED',
  Rejeté: 'REJECTED',
  Annulé: 'REJECTED',
}

const STATUS_BY_TEXT: ReadonlyMap<string, WorkItemStatus> = new Map([
  ...WORK_ITEM_STATUSES.map((status) => [normalizeLabel(status), status] as const),
  ...WORK_ITEM_STATUSES.map((status) => [normalizeLabel(STATUS_LABELS[status]), status] as const),
  ...Object.entries(STATUS_SYNONYMS).map(([text, status]) => [normalizeLabel(text), status] as const),
])

/** Libellé ou code de statut → code (insensible à la casse et aux accents) ; null si inconnu. */
export function matchStatus(text: string): WorkItemStatus | null {
  return STATUS_BY_TEXT.get(normalizeLabel(text)) ?? null
}

// --- Cellules ----------------------------------------------------------------------------------------

/**
 * Codes d'erreur du moteur de formules d'Atelier Tab (liste fermée, src/engine/formula/values.ts : ERROR_CODES).
 * Un texte saisi qui leur ressemble (« #URGENT! ») reste une valeur.
 */
export const FORMULA_ERROR_CODES: ReadonlySet<string> = new Set([
  '#REF!',
  '#DIV/0!',
  '#VALUE!',
  '#NAME?',
  '#NUM!',
  '#N/A',
  '#CYCLE!',
  '#ERROR!',
])

const NUMBER_FORMAT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })

type CellText = { text: string | null; error?: string }

/** Valeur calculée d'une cellule en texte (null = vide). Une erreur de formule compte comme vide. */
function cellText(cell: DataflowCell | undefined): CellText {
  if (!cell) return { text: null }
  const { computed, raw } = cell
  if (typeof computed === 'number') return { text: Number.isFinite(computed) ? NUMBER_FORMAT.format(computed) : null }
  if (typeof computed === 'boolean') return { text: computed ? 'Oui' : 'Non' }
  if (typeof computed === 'string') {
    if (FORMULA_ERROR_CODES.has(computed.trim())) return { text: null, error: computed.trim() }
    const text = computed.trim()
    return { text: text === '' ? null : text }
  }
  // computed null : la saisie d'origine, sauf une formule (non évaluée).
  const fallback = raw.trim()
  return { text: fallback === '' || fallback.startsWith('=') ? null : fallback }
}

/** Date d'une cellule : AAAA-MM-JJ (éventuellement suivie d'une heure) ou JJ/MM/AAAA. */
function cellDate(text: string): string | null {
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.exec(text)
  const french = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text)
  const candidate = iso ? iso[1] : french ? `${french[3]}-${french[2]}-${french[1]}` : null
  if (!candidate) return null
  try {
    parseDateOnly(candidate)
    return candidate
  } catch {
    return null
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/** Texte sûr dans une cellule de tableau Markdown (une ligne, « | » échappé). */
function tableCell(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

// --- Plan d'import -----------------------------------------------------------------------------------

export interface PlannedItem {
  recordId: string
  rowIndex: number
  externalRef: string
  title: string
  status: WorkItemStatus
  startDate: string | null
  dueDate: string | null
  description: string
}

export interface SkippedRecord {
  recordId: string
  rowIndex: number
  reason: string
}

export interface ImportPlan {
  /** Projet cherché (ou créé) par son nom quand aucun projectId n'est donné. */
  projectName: string
  epicTitle: string
  storyTitle: string
  items: PlannedItem[]
  skipped: SkippedRecord[]
  warnings: string[]
}

/** Identité stable d'un enregistrement : « atelier-tab:<source_table.id ?? project.id>:<record_id> ». */
export function externalRefOf(envelope: DataflowEnvelope, recordId: string): string {
  return `${EXTERNAL_REF_PREFIX}:${envelope.project.source_table?.id ?? envelope.project.id}:${recordId}`
}

const SINGLE_ROLES = ['entity_title', 'workflow_state', 'start_date', 'due_date', 'description'] as const
type SingleRole = (typeof SINGLE_ROLES)[number]

const ROLE_LABEL: Record<SingleRole, string> = {
  entity_title: 'titre',
  workflow_state: 'statut',
  start_date: 'date de début',
  due_date: 'échéance',
  description: 'description',
}

export function planAtelierTabImport(
  envelope: DataflowEnvelope,
  options: { maxDescriptionLength?: number } = {},
): ImportPlan {
  const maxDescription = options.maxDescriptionLength ?? DEFAULT_MAX_DESCRIPTION_LENGTH
  const { workspace, project } = envelope
  const warnings: string[] = []

  // Une colonne par rôle « simple » (la première) ; les autres colonnes vont dans le tableau de données.
  const roleColumn = new Map<SingleRole, DataflowColumn>()
  const dataColumns: DataflowColumn[] = []
  for (const column of project.columns_schema) {
    const role = column.atelier_mapping as SingleRole
    if ((SINGLE_ROLES as readonly string[]).includes(role)) {
      const first = roleColumn.get(role)
      if (!first) {
        roleColumn.set(role, column)
        continue
      }
      warnings.push(
        `Plusieurs colonnes ont le rôle ${ROLE_LABEL[role]} : « ${first.label} » est utilisée, « ${column.label} » est recopiée dans les données.`,
      )
    }
    dataColumns.push(column)
  }
  const titleColumn = roleColumn.get('entity_title')
  if (!titleColumn) warnings.push('Aucune colonne n’a le rôle « entity_title » : aucune ligne ne peut être importée.')

  const projectName = truncate(project.name.trim() || 'Atelier Tab', MAX_TITLE_LENGTH)
  const epicTitle = truncate(workspace.name.trim() || 'Atelier Tab', MAX_TITLE_LENGTH)
  const storyTitle = truncate((project.source_table?.name ?? project.name).trim() || 'Table importée', MAX_TITLE_LENGTH)
  const source = [workspace.name.trim(), project.name.trim(), project.source_table?.name.trim()].filter(Boolean).join(' › ')

  const items: PlannedItem[] = []
  const skipped: SkippedRecord[] = []
  const seen = new Set<string>()

  for (const record of project.records) {
    const line = `Ligne ${record.row_index}`
    const read = (column: DataflowColumn | undefined): string | null => {
      if (!column) return null
      const { text, error } = cellText(record.values[column.col_letter])
      if (error) warnings.push(`${line}, colonne « ${column.label} » : erreur de formule ${error}, valeur ignorée.`)
      return text
    }

    if (seen.has(record.record_id)) {
      const reason = `identifiant « ${record.record_id} » en double dans le fichier`
      skipped.push({ recordId: record.record_id, rowIndex: record.row_index, reason })
      warnings.push(`${line} ignorée : ${reason}.`)
      continue
    }
    seen.add(record.record_id)

    const rawTitle = read(titleColumn)
    if (rawTitle === null) {
      const reason = 'titre vide'
      skipped.push({ recordId: record.record_id, rowIndex: record.row_index, reason })
      warnings.push(`${line} ignorée : ${reason}.`)
      continue
    }
    const title = truncate(rawTitle.replace(/\s+/g, ' '), MAX_TITLE_LENGTH)
    if (title.length < rawTitle.length) warnings.push(`${line} : titre tronqué à ${MAX_TITLE_LENGTH} caractères.`)

    let status: WorkItemStatus = 'OPEN'
    const stateText = read(roleColumn.get('workflow_state'))
    if (stateText !== null) {
      const matched = matchStatus(stateText)
      if (matched) status = matched
      else warnings.push(`${line} : statut « ${stateText} » inconnu, « ${STATUS_LABELS.OPEN} » retenu.`)
    }

    const dateOf = (role: 'start_date' | 'due_date'): string | null => {
      const text = read(roleColumn.get(role))
      if (text === null) return null
      const date = cellDate(text)
      if (date === null) warnings.push(`${line} : ${ROLE_LABEL[role]} « ${text} » illisible (AAAA-MM-JJ attendu), ignorée.`)
      return date
    }
    let startDate = dateOf('start_date')
    const dueDate = dateOf('due_date')
    if (startDate && dueDate && dueDate < startDate) {
      warnings.push(`${line} : la date de début suit l’échéance, début ignoré.`)
      startDate = null
    }

    const rows = dataColumns.flatMap((column) => {
      const text = read(column)
      return text === null ? [] : [`| ${tableCell(column.label || column.col_letter)} | ${tableCell(text)} |`]
    })
    const parts = [read(roleColumn.get('description')) ?? '']
    if (rows.length > 0) parts.push(['### Données Atelier Tab', '', '| Champ | Valeur |', '| --- | --- |', ...rows].join('\n'))
    parts.push(`_Importé d’Atelier Tab${source ? ` (${source})` : ''}, ligne ${record.row_index}._`)
    const description = truncate(parts.filter((part) => part.trim() !== '').join('\n\n'), maxDescription)

    items.push({
      recordId: record.record_id,
      rowIndex: record.row_index,
      externalRef: externalRefOf(envelope, record.record_id),
      title,
      status,
      startDate,
      dueDate,
      description,
    })
  }

  return { projectName, epicTitle, storyTitle, items, skipped, warnings }
}
