// Import DataFlow depuis Atelier Tab (docs/SUITE.md §4.1) : aperçu (aucune écriture) et import idempotent.
// Rangement : Projet › Phase « Imports Atelier Tab » › Epic <workspace.name> › Story <table ou projet>,
// conteneurs retrouvés par leur titre et créés au besoin. Chaque élément garde son externalRef : un réimport
// met à jour l'élément existant (où qu'il ait été déplacé) au lieu d'en créer un autre.
//
// Idempotence : la réponse d'un import est enregistrée dans la table ImportIdempotency, dans la même
// transaction que l'import. Une table SQLite plutôt qu'un cache en mémoire : la clé survit à un redémarrage
// de l'API (nouvelle tentative du webhook après une coupure), sans dépendance de plus, et l'enregistrement
// est atomique avec l'import (pas de fenêtre où l'import est fait mais la clé perdue).
import { createHash, timingSafeEqual } from 'node:crypto'
import {
  ATELIER_TAB_SCHEMA_VERSION,
  IMPORT_PHASE_TITLE,
  planAtelierTabImport,
  type DataflowEnvelope,
  type ImportPlan,
  type PlannedItem,
} from '../domain/atelier-tab.ts'
import { formatDateOnlyOrNull, parseDateOnlyOrNull } from '../domain/dates.ts'
import { slugify, slugSearchPrefix, uniqueSlug } from '../domain/slug.ts'
import { isDone, type WorkItemType } from '../domain/workflow.ts'
import type { PrismaClient } from '../db/client.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { HttpError, notFound } from '../http/errors.ts'
import { MARKDOWN_MAX_LENGTH } from '../schemas/common.ts'
import type { ImportOptions, ImportPreviewDto, ImportResultDto } from '../schemas/atelier-tab.ts'
import { nextPosition } from './common.ts'

type Tx = Prisma.TransactionClient | PrismaClient

/** Réponses d'import conservées (rejeu d'une clé Idempotency-Key) : 30 jours. */
export const IDEMPOTENCY_RETENTION_MS = 30 * 24 * 3600 * 1000
/** Un gros import (milliers de lignes) dépasse le délai par défaut de 5 s d'une transaction Prisma. */
const TRANSACTION_TIMEOUT_MS = 120_000

export interface ImportRequest {
  envelope: DataflowEnvelope
  options: ImportOptions
  headers: { idempotencyKey?: string; schemaVersion?: string }
}

// --- Contrôles d'en-tête -------------------------------------------------------------------------------

const sha256 = (text: string): Buffer => createHash('sha256').update(text, 'utf8').digest()

/**
 * Jeton ATELIER_IMPORT_TOKEN : ignoré s'il n'est pas configuré, exigé (Bearer) sinon.
 * Comparaison des empreintes SHA-256 (longueur fixe) : ni le contenu ni la longueur du jeton ne fuient par le temps de réponse.
 */
export function assertImportToken(expected: string | undefined, authorization: string | undefined): void {
  if (!expected) return
  const match = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? '')
  if (!timingSafeEqual(sha256(match?.[1]?.trim() ?? ''), sha256(expected))) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Jeton d’import absent ou invalide (en-tête Authorization: Bearer <ATELIER_IMPORT_TOKEN>)')
  }
}

/** Version du schéma : en-tête X-Atelier-Schema-Version (si présent) et enveloppe doivent valoir 2.1.0. */
export function assertSchemaVersion(header: string | undefined, envelope: DataflowEnvelope): void {
  for (const [source, version] of [
    ['X-Atelier-Schema-Version', header],
    ['schema_version', envelope.schema_version],
  ] as const) {
    if (version !== undefined && version.trim() !== ATELIER_TAB_SCHEMA_VERSION) {
      throw new HttpError(
        422,
        'UNSUPPORTED_SCHEMA_VERSION',
        `Version de schéma DataFlow non prise en charge (${source} : « ${version} ») : ${ATELIER_TAB_SCHEMA_VERSION} attendue`,
      )
    }
  }
}

// --- Analyse (partagée par l'aperçu et l'import) -------------------------------------------------------

interface Target {
  project: { id: number; name: string } | null
  phaseId: number | null
  epicId: number | null
  storyId: number | null
}

interface ExistingItem {
  id: number
  projectId: number
  title: string
  status: string
  description: string
  startDate: Date | null
  dueDate: Date | null
}

type Action = 'created' | 'updated' | 'unchanged'

async function findTarget(tx: Tx, plan: ImportPlan, options: ImportOptions): Promise<Target> {
  let project: { id: number; name: string } | null
  if (options.projectId !== undefined) {
    project = await tx.project.findUnique({ where: { id: options.projectId }, select: { id: true, name: true } })
    if (!project) throw notFound(`Projet #${options.projectId} introuvable`)
  } else {
    project = await tx.project.findFirst({ where: { name: plan.projectName }, select: { id: true, name: true }, orderBy: { id: 'asc' } })
  }
  const phase = project
    ? await tx.phase.findFirst({ where: { projectId: project.id, title: IMPORT_PHASE_TITLE }, select: { id: true }, orderBy: { id: 'asc' } })
    : null
  const epic = phase
    ? await tx.epic.findFirst({ where: { phaseId: phase.id, title: plan.epicTitle }, select: { id: true }, orderBy: { id: 'asc' } })
    : null
  const story = epic
    ? await tx.story.findFirst({ where: { epicId: epic.id, title: plan.storyTitle }, select: { id: true }, orderBy: { id: 'asc' } })
    : null
  return { project, phaseId: phase?.id ?? null, epicId: epic?.id ?? null, storyId: story?.id ?? null }
}

async function findExisting(tx: Tx, plan: ImportPlan): Promise<Map<string, ExistingItem>> {
  const refs = plan.items.map((item) => item.externalRef)
  const found = new Map<string, ExistingItem>()
  // Lots de 500 : bien en deçà de la limite de variables d'une requête SQLite.
  for (let start = 0; start < refs.length; start += 500) {
    const rows = await tx.workItem.findMany({
      where: { externalRef: { in: refs.slice(start, start + 500) } },
      select: { id: true, projectId: true, externalRef: true, title: true, status: true, description: true, startDate: true, dueDate: true },
    })
    for (const { externalRef, ...row } of rows) if (externalRef) found.set(externalRef, row)
  }
  return found
}

function actionFor(item: PlannedItem, existing: ExistingItem | undefined): Action {
  if (!existing) return 'created'
  const same =
    existing.title === item.title &&
    existing.status === item.status &&
    existing.description === item.description &&
    formatDateOnlyOrNull(existing.startDate) === item.startDate &&
    formatDateOnlyOrNull(existing.dueDate) === item.dueDate
  return same ? 'unchanged' : 'updated'
}

function movedWarnings(plan: ImportPlan, existing: Map<string, ExistingItem>, projectId: number | null): string[] {
  if (projectId === null) return []
  return plan.items.flatMap((item) => {
    const current = existing.get(item.externalRef)
    return current && current.projectId !== projectId
      ? [`Ligne ${item.rowIndex} : l’élément #${current.id} existe déjà dans un autre projet, il y est mis à jour.`]
      : []
  })
}

function itemRow(item: PlannedItem, workItemId: number | null, action: Action) {
  const { recordId, rowIndex, title, status, startDate, dueDate } = item
  return { recordId, rowIndex, workItemId, action, title, status, startDate, dueDate, reason: null }
}

function skippedRows(plan: ImportPlan) {
  return plan.skipped.map(({ recordId, rowIndex, reason }) => ({
    recordId,
    rowIndex,
    workItemId: null,
    action: 'skipped' as const,
    title: null,
    status: null,
    startDate: null,
    dueDate: null,
    reason,
  }))
}

function sortedByRow<T extends { rowIndex: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.rowIndex - b.rowIndex)
}

function count(rows: { action: string }[], action: string): number {
  return rows.filter((row) => row.action === action).length
}

// --- Aperçu --------------------------------------------------------------------------------------------

export async function previewAtelierTabImport(prisma: PrismaClient, request: ImportRequest): Promise<ImportPreviewDto> {
  const { envelope, options } = request
  assertSchemaVersion(request.headers.schemaVersion, envelope)
  const plan = planAtelierTabImport(envelope, { maxDescriptionLength: MARKDOWN_MAX_LENGTH })
  const target = await findTarget(prisma, plan, options)
  const existing = await findExisting(prisma, plan)
  const items = sortedByRow([
    ...plan.items.map((item) => {
      const current = existing.get(item.externalRef)
      return itemRow(item, current?.id ?? null, actionFor(item, current))
    }),
    ...skippedRows(plan),
  ])
  return {
    projectId: target.project?.id ?? null,
    storyId: target.storyId,
    created: count(items, 'created'),
    updated: count(items, 'updated'),
    unchanged: count(items, 'unchanged'),
    skipped: count(items, 'skipped'),
    warnings: [...plan.warnings, ...movedWarnings(plan, existing, target.project?.id ?? null)],
    items,
    target: {
      project: { id: target.project?.id ?? null, name: target.project?.name ?? plan.projectName, exists: target.project !== null },
      phase: { title: IMPORT_PHASE_TITLE, exists: target.phaseId !== null },
      epic: { title: plan.epicTitle, exists: target.epicId !== null },
      story: { title: plan.storyTitle, exists: target.storyId !== null },
      type: options.type ?? 'TASK',
    },
  }
}

// --- Import --------------------------------------------------------------------------------------------

async function createProject(tx: Tx, name: string): Promise<{ id: number; name: string }> {
  const base = slugify(name)
  const taken = await tx.project.findMany({ where: { slug: { startsWith: slugSearchPrefix(base) } }, select: { slug: true } })
  const slugs = new Set(taken.map((project) => project.slug))
  const project = await tx.project.create({
    data: { name, slug: uniqueSlug(base, (slug) => slugs.has(slug)), description: 'Projet créé par un import Atelier Tab.' },
  })
  return { id: project.id, name: project.name }
}

async function ensureContainers(tx: Tx, plan: ImportPlan, target: Target): Promise<{ projectId: number; storyId: number }> {
  const project = target.project ?? (await createProject(tx, plan.projectName))
  let { phaseId, epicId, storyId } = target
  if (phaseId === null) {
    const max = await tx.phase.aggregate({ where: { projectId: project.id }, _max: { position: true } })
    phaseId = (
      await tx.phase.create({
        data: {
          projectId: project.id,
          title: IMPORT_PHASE_TITLE,
          description: 'Éléments importés depuis Atelier Tab (DataFlow).',
          position: nextPosition(max._max.position),
        },
      })
    ).id
  }
  if (epicId === null) {
    const max = await tx.epic.aggregate({ where: { phaseId }, _max: { position: true } })
    epicId = (await tx.epic.create({ data: { phaseId, title: plan.epicTitle, position: nextPosition(max._max.position) } })).id
  }
  if (storyId === null) {
    const max = await tx.story.aggregate({ where: { epicId }, _max: { position: true } })
    storyId = (await tx.story.create({ data: { epicId, title: plan.storyTitle, position: nextPosition(max._max.position) } })).id
  }
  return { projectId: project.id, storyId }
}

function requestHash(request: ImportRequest): string {
  return createHash('sha256')
    .update(JSON.stringify({ options: request.options, envelope: request.envelope }))
    .digest('hex')
}

export interface ImportOutcome {
  result: ImportResultDto
  /** Réponse rejouée depuis une clé Idempotency-Key déjà traitée. */
  replayed: boolean
}

async function storedResponse(tx: Tx, key: string, hash: string): Promise<ImportOutcome | null> {
  const stored = await tx.importIdempotency.findUnique({ where: { key } })
  if (!stored) return null
  if (stored.requestHash !== hash) {
    throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'Cette clé Idempotency-Key a déjà servi pour un autre contenu : utiliser une nouvelle clé')
  }
  return { result: JSON.parse(stored.response) as ImportResultDto, replayed: true }
}

export async function importFromAtelierTab(
  prisma: PrismaClient,
  request: ImportRequest,
  now: Date = new Date(),
): Promise<ImportOutcome> {
  const { envelope, options } = request
  assertSchemaVersion(request.headers.schemaVersion, envelope)
  const key = request.headers.idempotencyKey?.trim() || null
  const hash = key ? requestHash(request) : ''
  if (key) {
    const replay = await storedResponse(prisma, key, hash)
    if (replay) return replay
  }

  const plan = planAtelierTabImport(envelope, { maxDescriptionLength: MARKDOWN_MAX_LENGTH })
  const type: WorkItemType = options.type ?? 'TASK'

  try {
    return await prisma.$transaction(
      async (tx) => {
        // Deux envois simultanés de la même clé : le second voit la réponse du premier.
        if (key) {
          const replay = await storedResponse(tx, key, hash)
          if (replay) return replay
        }
        const target = await findTarget(tx, plan, options)
        const existing = await findExisting(tx, plan)
        const warnings = [...plan.warnings, ...movedWarnings(plan, existing, target.project?.id ?? null)]
        const rows: ReturnType<typeof itemRow>[] = []
        let projectId = target.project?.id ?? null
        let storyId = target.storyId

        if (plan.items.length > 0) {
          const containers = await ensureContainers(tx, plan, target)
          projectId = containers.projectId
          storyId = containers.storyId
          const max = await tx.workItem.aggregate({ where: { storyId }, _max: { position: true } })
          let position = nextPosition(max._max.position)

          for (const item of plan.items) {
            const current = existing.get(item.externalRef)
            const action = actionFor(item, current)
            const fields = {
              title: item.title,
              status: item.status,
              description: item.description,
              startDate: parseDateOnlyOrNull(item.startDate),
              dueDate: parseDateOnlyOrNull(item.dueDate),
            }
            if (!current) {
              const created = await tx.workItem.create({
                data: {
                  ...fields,
                  projectId,
                  storyId,
                  type,
                  externalRef: item.externalRef,
                  progress: isDone(item.status) ? 100 : 0,
                  position: position++,
                },
              })
              rows.push(itemRow(item, created.id, action))
            } else {
              if (action === 'updated') {
                // Résolu / terminé ⇒ 100 % ; rouvert : l'avancement est conservé (règle de l'API).
                await tx.workItem.update({
                  where: { id: current.id },
                  data: { ...fields, ...(isDone(item.status) && { progress: 100 }) },
                })
              }
              rows.push(itemRow(item, current.id, action))
            }
          }
        }

        const items = sortedByRow([...rows, ...skippedRows(plan)])
        const result: ImportResultDto = {
          projectId,
          storyId,
          created: count(items, 'created'),
          updated: count(items, 'updated'),
          unchanged: count(items, 'unchanged'),
          skipped: count(items, 'skipped'),
          warnings,
          items,
        }
        if (key) {
          await tx.importIdempotency.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS) } } })
          await tx.importIdempotency.create({ data: { key, requestHash: hash, statusCode: 200, response: JSON.stringify(result), createdAt: now } })
        }
        return { result, replayed: false }
      },
      { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_TIMEOUT_MS },
    )
  } catch (error) {
    // Course perdue sur la clé (P2002) : l'autre requête a importé ; renvoyer sa réponse.
    if (key && (error as { code?: string }).code === 'P2002') {
      const replay = await storedResponse(prisma, key, hash)
      if (replay) return replay
    }
    throw error
  }
}
