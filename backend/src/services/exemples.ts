// Exemples de la suite (exemples-suite/, format atelier-exemples/1) : histoires fictives communes à toutes les apps,
// générées par Atelier_Deploy (exemples/generer.py) et copiées telles quelles dans chaque dépôt.
//
// Pour Projets, une histoire apporte un projet complet (phases, epics, stories, éléments, temps passés, jalons) et la
// tâche de suivi née de l'alerte de Viz, comme la crée le workflow Nexus « Alerte Viz → tâche de suivi Projets ».
// Tout passe par les services existants (événements du nœud Atelier compris). Le projet créé est noté dans
// AppSetting (clé « exemplesSuite ») : retirer l'exemple supprime ce projet, et lui seul.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Db } from '../db/client.ts'
import { badRequest, conflict, notFound } from '../http/errors.ts'
import type { ExempleChargeDto, ExempleHistoireDto } from '../schemas/exemples.ts'
import { createEpic, createPhase, createStory } from './hierarchy.ts'
import { createMilestone } from './milestones.ts'
import { createProject, deleteProject, listProjects } from './projects.ts'
import { createTimeEntry } from './time-entries.ts'
import { addLogEntry, createWorkItem } from './work-items.ts'

export const EXEMPLES_FORMAT = 'atelier-exemples/1'
const STATE_KEY = 'exemplesSuite'
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/
/** Une saisie de temps est bornée à 24 h : un temps passé plus long est réparti sur des journées de 7 h. */
const HOURS_PER_ENTRY = 7

interface Clock {
  timeZone: string
  now: Date
}

interface Etape {
  app: string
  titre: string
  texte: string
}

interface Item {
  titre: string
  type: 'FEATURE' | 'TASK' | 'BUG'
  statut: string
  priorite: 'LOW' | 'NORMAL' | 'HIGH' | 'IMMEDIATE'
  estime: number | null
  passe: number | null
  echeance: string | null
}

interface Part {
  format: string
  histoire: { id: string; titre: string; sous_titre: string; secteur: string; resume: string }
  projet: { nom: string; description: string }
  phases: { titre: string; epics: { titre: string; stories: { titre: string; alertes: boolean; items: Item[] }[] }[] }[]
  jalons: { titre: string; date: string; atteint: boolean }[]
  tache_alerte: { story: string | null; titre: string; description: string; journal: string }
}

type State = Record<string, number>

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const data: unknown = JSON.parse(await readFile(file, 'utf8'))
    return data !== null && typeof data === 'object' && (data as { format?: unknown }).format === EXEMPLES_FORMAT
      ? (data as T)
      : null
  } catch {
    return null
  }
}

async function readPart(dir: string, histoire: string): Promise<Part> {
  const part = ID.test(histoire) ? await readJson<Part>(path.join(dir, `${histoire}.json`)) : null
  if (part === null || !Array.isArray(part.phases)) throw notFound('Exemple introuvable')
  return part
}

async function readState(prisma: Db): Promise<State> {
  const row = await prisma.appSetting.findUnique({ where: { key: STATE_KEY } })
  try {
    const value: unknown = row ? JSON.parse(row.value) : {}
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as State) : {}
  } catch {
    return {}
  }
}

async function writeState(prisma: Db, state: State): Promise<void> {
  if (Object.keys(state).length === 0) {
    await prisma.appSetting.deleteMany({ where: { key: STATE_KEY } })
    return
  }
  const value = JSON.stringify(state)
  await prisma.appSetting.upsert({ where: { key: STATE_KEY }, create: { key: STATE_KEY, value }, update: { value } })
}

/** Projets d'exemple encore présents (un projet supprimé à la main n'est plus « chargé »). */
async function liveState(prisma: Db): Promise<State> {
  const state = await readState(prisma)
  const ids = new Set((await listProjects(prisma)).map((p) => p.id))
  return Object.fromEntries(Object.entries(state).filter(([, id]) => ids.has(id)))
}

/** Histoires livrées avec cette installation (liste vide si le dossier est absent). */
export async function listExemples(prisma: Db, dir: string): Promise<ExempleHistoireDto[]> {
  const index = await readJson<{ histoires?: (Part['histoire'] & { parcours?: Etape[] })[] }>(path.join(dir, 'index.json'))
  if (index === null) return []
  const state = await liveState(prisma)
  const out: ExempleHistoireDto[] = []
  for (const h of index.histoires ?? []) {
    let part: Part
    try {
      part = await readPart(dir, h.id)
    } catch {
      continue
    }
    const items = part.phases.flatMap((p) => p.epics.flatMap((e) => e.stories.flatMap((s) => s.items))).length
    out.push({
      id: h.id,
      titre: h.titre,
      sous_titre: h.sous_titre,
      secteur: h.secteur,
      resume: h.resume,
      parcours: h.parcours ?? [],
      projet: part.projet.nom,
      elements: items + 1,
      jalons: part.jalons.length,
      charge: state[h.id] !== undefined,
      projectId: state[h.id] ?? null,
    })
  }
  return out
}

/** Dates de travail (jours ouvrés) qui précèdent `end`, la plus ancienne d'abord. */
function workDaysBefore(end: Date, count: number): string[] {
  const days: string[] = []
  const d = new Date(end)
  while (days.length < count) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) days.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return days
}

function lastDay(dates: string[], clock: Clock): Date {
  const today = clock.now.toISOString().slice(0, 10)
  const target = dates.filter((x) => x <= today).sort().at(-1) ?? today
  return new Date(`${target}T00:00:00Z`)
}

/** Charge l'histoire une fois : un second appel renvoie le projet déjà créé. */
export async function loadExemple(prisma: Db, dir: string, histoire: string, clock: Clock): Promise<ExempleChargeDto> {
  const part = await readPart(dir, histoire)
  const state = await liveState(prisma)
  if (state[histoire] !== undefined) return { histoire, projectId: state[histoire], dejaCharge: true, storyAlerteId: null }
  if ((await listProjects(prisma)).some((p) => p.name === part.projet.nom)) {
    throw conflict(`Un projet « ${part.projet.nom} » existe déjà : renommez-le pour charger l'exemple`)
  }

  const project = await createProject(prisma, { name: part.projet.nom, description: part.projet.description })
  await writeState(prisma, { ...(await readState(prisma)), [histoire]: project.id })
  try {
    let storyAlerteId: number | null = null
    for (const p of part.phases) {
      const phase = await createPhase(prisma, project.id, { title: p.titre })
      for (const e of p.epics) {
        const epic = await createEpic(prisma, phase.id, { title: e.titre })
        for (const s of e.stories) {
          const story = await createStory(prisma, epic.id, { title: s.titre })
          if (s.alertes) storyAlerteId = story.id
          for (const it of s.items) await createItem(prisma, story.id, it, clock)
        }
      }
    }
    if (storyAlerteId !== null) {
      const a = part.tache_alerte
      const item = await createWorkItem(prisma, storyAlerteId, {
        type: 'TASK', title: a.titre, status: 'OPEN', priority: 'HIGH', description: a.description,
      }, clock.now)
      await addLogEntry(prisma, item.id, { text: a.journal }, clock)
    }
    for (const j of part.jalons) {
      const reached = j.atteint ? new Date(Math.min(Date.parse(`${j.date}T17:00:00Z`), clock.now.getTime() - 60_000)) : null
      await createMilestone(prisma, project.id, {
        title: j.titre, date: j.date, ...(reached ? { reachedAt: reached.toISOString() } : {}),
      }, clock.now)
    }
    return { histoire, projectId: project.id, dejaCharge: false, storyAlerteId }
  } catch (error) {
    // Chargement interrompu : rien ne reste à moitié.
    await removeExemple(prisma, dir, histoire, clock.now).catch(() => undefined)
    throw error
  }
}

async function createItem(prisma: Db, storyId: number, it: Item, clock: Clock): Promise<void> {
  const item = await createWorkItem(prisma, storyId, {
    type: it.type,
    title: it.titre,
    status: it.statut as never,
    priority: it.priorite,
    ...(it.estime ? { estimatedHours: it.estime } : {}),
    ...(it.echeance ? { dueDate: it.echeance } : {}),
  }, clock.now)
  if (!it.passe) return
  // Temps passé réparti en journées de 7 h au plus, jusqu'à l'échéance (ou aujourd'hui si elle est à venir).
  const parts = Math.ceil(it.passe / HOURS_PER_ENTRY)
  const days = workDaysBefore(lastDay(it.echeance ? [it.echeance] : [], clock), parts)
  let left = it.passe
  for (const day of days) {
    const hours = Math.min(HOURS_PER_ENTRY, Math.round(left * 100) / 100)
    if (hours <= 0) break
    await createTimeEntry(prisma, item.id, { hours, spentOn: day, comment: 'Exemple de la suite' }, clock)
    left -= hours
  }
}

/** Supprime le projet créé par l'histoire (et rien d'autre). */
export async function removeExemple(prisma: Db, dir: string, histoire: string, now: Date): Promise<void> {
  if (!ID.test(histoire)) throw badRequest('Identifiant d’exemple invalide')
  await readPart(dir, histoire)
  const state = await readState(prisma)
  const projectId = state[histoire]
  if (projectId === undefined) throw notFound('Cet exemple n’est pas chargé')
  if ((await listProjects(prisma)).some((p) => p.id === projectId)) await deleteProject(prisma, projectId, now)
  const { [histoire]: _removed, ...rest } = state
  await writeState(prisma, rest)
}
