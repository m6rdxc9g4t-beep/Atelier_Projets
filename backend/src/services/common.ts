// Briques partagées des services : chargement avec 404, positions, dates et conversions saisies.
import { parseDateOnlyOrNull } from '../domain/dates.ts'
import { daysToHours, roundTo } from '../domain/durations.ts'
import type { Db } from '../db/client.ts'
import type { Epic, Phase, Project, Story } from '../generated/prisma/client.ts'
import { badRequest, notFound } from '../http/errors.ts'

export async function requireProject(prisma: Db, projectId: number): Promise<Project> {
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project) throw notFound(`Projet #${projectId} introuvable`)
  return project
}

export async function requirePhase(prisma: Db, phaseId: number): Promise<Phase & { project: Project }> {
  const phase = await prisma.phase.findUnique({ where: { id: phaseId }, include: { project: true } })
  if (!phase) throw notFound(`Phase #${phaseId} introuvable`)
  return phase
}

export async function requireEpic(prisma: Db, epicId: number): Promise<Epic & { phase: Phase }> {
  const epic = await prisma.epic.findUnique({ where: { id: epicId }, include: { phase: true } })
  if (!epic) throw notFound(`Epic #${epicId} introuvable`)
  return epic
}

export async function requireStory(
  prisma: Db,
  storyId: number,
): Promise<Story & { epic: Epic & { phase: Phase & { project: Project } } }> {
  const story = await prisma.story.findUnique({
    where: { id: storyId },
    include: { epic: { include: { phase: { include: { project: true } } } } },
  })
  if (!story) throw notFound(`Story #${storyId} introuvable`)
  return story
}

/** Position suivante parmi des éléments frères (1 pour le premier). */
export function nextPosition(max: number | null | undefined): number {
  return (max ?? 0) + 1
}

/**
 * Valeur saisie soit en heures, soit en jours (convertis avec hoursPerDay).
 * undefined = champ non fourni (inchangé), null = effacé.
 */
export function resolveHours(
  hours: number | null | undefined,
  days: number | null | undefined,
  hoursPerDay: number,
  field: string,
): number | null | undefined {
  if (hours !== undefined && days !== undefined) {
    if (hours === null && days === null) return null // effacer, quelle que soit l'unité
    throw badRequest(`Indiquer ${field}Hours ou ${field}Days, pas les deux`)
  }
  if (days !== undefined) return days === null ? null : daysToHours(days, hoursPerDay)
  if (hours !== undefined) return hours === null ? null : roundTo(hours, 2)
  return undefined
}

/** Date calendaire saisie → Date (00:00 UTC) ; une date inexistante devient une erreur 400. */
export function inputDate(value: string): Date
export function inputDate(value: string | null): Date | null
export function inputDate(value: string | null): Date | null {
  try {
    return parseDateOnlyOrNull(value)
  } catch (error) {
    if (error instanceof RangeError) throw badRequest(error.message)
    throw error
  }
}

/** Date saisie : undefined = conserver `current`, null = effacer, chaîne = nouvelle date (00:00 UTC). */
export function resolveDate(input: string | null | undefined, current: Date | null): Date | null {
  return input === undefined ? current : inputDate(input)
}

const MIN_TIMESTAMP_YEAR = 1970
const MAX_TIMESTAMP_YEAR = 9999

/**
 * Horodatage saisi (ISO 8601) → Date. Refuse (400) ce que le format accepte mais que l'application ne
 * sait pas stocker ou relire : seconde intercalaire, décalage incomplet, année hors 1970–9999 en UTC.
 */
export function inputTimestamp(value: string, field: string, options: { notAfter?: Date } = {}): Date {
  const date = new Date(value)
  const year = date.getUTCFullYear()
  if (Number.isNaN(date.getTime()) || year < MIN_TIMESTAMP_YEAR || year > MAX_TIMESTAMP_YEAR) {
    throw badRequest(`${field} invalide : « ${value} » (horodatage ISO 8601 entre ${MIN_TIMESTAMP_YEAR} et ${MAX_TIMESTAMP_YEAR})`)
  }
  if (options.notAfter && date > options.notAfter) {
    throw badRequest(`${field} ne peut pas être dans le futur`)
  }
  return date
}

export function assertDateOrder(startDate: Date | null, dueDate: Date | null): void {
  if (startDate && dueDate && dueDate < startDate) {
    throw badRequest('La date d’échéance (dueDate) précède la date de début (startDate)')
  }
}
