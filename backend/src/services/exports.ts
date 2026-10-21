// Jeux de données pour Atelier Viz (docs/SUITE.md §4.3) : lignes plates, une colonne par champ, calculées
// ici (heures passées = somme des saisies de temps, écart = passées − estimées). Lecture seule.
import { roundTo, sumHours } from '../domain/durations.ts'
import { formatDateOnly, formatDateOnlyOrNull } from '../domain/dates.ts'
import { STATUS_LABELS } from '../domain/atelier-tab.ts'
import type { Priority } from '../domain/workflow.ts'
import type { Db } from '../db/client.ts'
import type { DatasetColumn, DatasetDto, DatasetInfoDto, DatasetName, DatasetOptions } from '../schemas/exports.ts'
import { requireProject } from './common.ts'
import { spentHoursByWorkItem } from './work-items.ts'

const PRIORITY_LABELS: Record<Priority, string> = { LOW: 'Basse', NORMAL: 'Normale', HIGH: 'Haute', IMMEDIATE: 'Immédiate' }

type Row = Record<string, string | number | boolean | null>

interface DatasetDefinition {
  label: string
  description: string
  columns: DatasetColumn[]
  count(prisma: Db): Promise<number>
  rows(prisma: Db, projectId: number | undefined): Promise<Row[]>
}

const col = (key: string, label: string, type: DatasetColumn['type']): DatasetColumn => ({ key, label, type })

const DATASETS: Record<DatasetName, DatasetDefinition> = {
  'work-items': {
    label: 'Éléments de travail',
    description: 'Features, tâches et anomalies avec leur hiérarchie, statut, estimation, temps passé et écart.',
    columns: [
      col('id', 'ID', 'number'),
      col('projet', 'Projet', 'string'),
      col('phase', 'Phase', 'string'),
      col('epic', 'Epic', 'string'),
      col('story', 'Story', 'string'),
      col('type', 'Type', 'string'),
      col('statut', 'Statut', 'string'),
      col('statut_code', 'Code du statut', 'string'),
      col('priorite', 'Priorité', 'string'),
      col('titre', 'Titre', 'string'),
      col('heures_estimees', 'Heures estimées', 'number'),
      col('heures_passees', 'Heures passées', 'number'),
      col('ecart_heures', 'Écart (heures)', 'number'),
      col('avancement', 'Avancement (%)', 'number'),
      col('debut', 'Début', 'date'),
      col('echeance', 'Échéance', 'date'),
      col('cree_le', 'Créé le', 'datetime'),
      col('maj_le', 'Mis à jour le', 'datetime'),
    ],
    count: (prisma) => prisma.workItem.count(),
    async rows(prisma, projectId) {
      const where = projectId === undefined ? {} : { projectId }
      const [items, spent] = await Promise.all([
        prisma.workItem.findMany({
          where,
          omit: { description: true, implementationLog: true },
          include: { project: { select: { name: true } }, story: { select: { title: true, epic: { select: { title: true, phase: { select: { title: true } } } } } } },
          orderBy: [{ projectId: 'asc' }, { id: 'asc' }],
        }),
        spentHoursByWorkItem(prisma, projectId === undefined ? {} : { workItem: { projectId } }),
      ])
      return items.map((item) => {
        const spentHours = roundTo(spent.get(item.id) ?? 0, 2)
        return {
          id: item.id,
          projet: item.project.name,
          phase: item.story.epic.phase.title,
          epic: item.story.epic.title,
          story: item.story.title,
          type: item.type,
          statut: STATUS_LABELS[item.status],
          statut_code: item.status,
          priorite: PRIORITY_LABELS[item.priority],
          titre: item.title,
          heures_estimees: item.estimatedHours,
          heures_passees: spentHours,
          ecart_heures: item.estimatedHours === null ? null : roundTo(spentHours - item.estimatedHours, 2),
          avancement: item.progress,
          debut: formatDateOnlyOrNull(item.startDate),
          echeance: formatDateOnlyOrNull(item.dueDate),
          cree_le: item.createdAt.toISOString(),
          maj_le: item.updatedAt.toISOString(),
        }
      })
    },
  },
  'time-entries': {
    label: 'Saisies de temps',
    description: 'Une ligne par saisie de temps : élément, type, projet, jour et durée en heures.',
    columns: [
      col('id', 'ID', 'number'),
      col('element_id', 'ID de l’élément', 'number'),
      col('element', 'Élément', 'string'),
      col('type', 'Type', 'string'),
      col('projet', 'Projet', 'string'),
      col('date', 'Date', 'date'),
      col('heures', 'Heures', 'number'),
      col('commentaire', 'Commentaire', 'string'),
    ],
    count: (prisma) => prisma.timeEntry.count(),
    async rows(prisma, projectId) {
      const entries = await prisma.timeEntry.findMany({
        where: projectId === undefined ? {} : { workItem: { projectId } },
        include: { workItem: { select: { id: true, title: true, type: true, project: { select: { name: true } } } } },
        orderBy: [{ spentOn: 'asc' }, { id: 'asc' }],
      })
      return entries.map((entry) => ({
        id: entry.id,
        element_id: entry.workItem.id,
        element: entry.workItem.title,
        type: entry.workItem.type,
        projet: entry.workItem.project.name,
        date: formatDateOnly(entry.spentOn),
        heures: sumHours([entry.hours]),
        commentaire: entry.comment === '' ? null : entry.comment,
      }))
    },
  },
  milestones: {
    label: 'Jalons',
    description: 'Jalons des projets : phase de rattachement, date cible et atteinte.',
    columns: [
      col('id', 'ID', 'number'),
      col('projet', 'Projet', 'string'),
      col('phase', 'Phase', 'string'),
      col('nom', 'Nom', 'string'),
      col('date', 'Date', 'date'),
      col('atteint', 'Atteint', 'boolean'),
    ],
    count: (prisma) => prisma.milestone.count(),
    async rows(prisma, projectId) {
      const milestones = await prisma.milestone.findMany({
        where: projectId === undefined ? {} : { projectId },
        include: { project: { select: { name: true } }, phase: { select: { title: true } } },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
      })
      return milestones.map((milestone) => ({
        id: milestone.id,
        projet: milestone.project.name,
        phase: milestone.phase?.title ?? null,
        nom: milestone.title,
        date: formatDateOnly(milestone.date),
        atteint: milestone.reachedAt !== null,
      }))
    },
  },
}

export async function listDatasets(prisma: Db): Promise<DatasetInfoDto[]> {
  return Promise.all(
    (Object.keys(DATASETS) as DatasetName[]).map(async (name) => {
      const { label, description, count } = DATASETS[name]
      return { name, label, description, rowCount: await count(prisma) }
    }),
  )
}

export async function getDataset(prisma: Db, name: DatasetName, options: DatasetOptions, now: Date): Promise<DatasetDto> {
  if (options.projectId !== undefined) await requireProject(prisma, options.projectId)
  const { label, columns, rows } = DATASETS[name]
  return { name, label, generatedAt: now.toISOString(), columns, rows: await rows(prisma, options.projectId) }
}
