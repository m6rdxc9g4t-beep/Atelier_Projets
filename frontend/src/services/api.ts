// Services d'accès au backend, regroupés par ressource. Aucun calcul métier ici :
// les agrégats (budget, avancement, bilans, histogramme) arrivent déjà calculés.
import { http, unwrap } from './client.ts'
import type {
  AtelierTabEnvelope,
  AtelierTabImportOptions,
  BreakdownInput,
  ClaudeLaunchInput,
  ContainerInput,
  ContainerUpdate,
  LogEntryInput,
  MilestoneInput,
  MilestoneUpdate,
  SummarizeInput,
  ProjectInput,
  ProjectUpdate,
  TimeEntryInput,
  WorkItemInput,
  WorkItemStatus,
  WorkItemType,
  WorkItemUpdate,
} from './types.ts'

/** Option commune des vues : surcharge de « 1 jour = X heures ». */
export interface ViewOptions {
  hoursPerDay?: number
}

export const healthService = {
  check: () => unwrap(http.GET('/api/health')),
}

export const projectService = {
  list: () => unwrap(http.GET('/api/projects')),
  get: (projectId: number) => unwrap(http.GET('/api/projects/{projectId}', { params: { path: { projectId } } })),
  create: (body: ProjectInput) => unwrap(http.POST('/api/projects', { body })),
  update: (projectId: number, body: ProjectUpdate) =>
    unwrap(http.PATCH('/api/projects/{projectId}', { params: { path: { projectId } }, body })),
  remove: (projectId: number) => unwrap(http.DELETE('/api/projects/{projectId}', { params: { path: { projectId } } })),
}

export const reportService = {
  dashboard: (projectId: number, query: ViewOptions = {}) =>
    unwrap(http.GET('/api/projects/{projectId}/dashboard', { params: { path: { projectId }, query } })),
  tree: (projectId: number, query: ViewOptions = {}) =>
    unwrap(http.GET('/api/projects/{projectId}/tree', { params: { path: { projectId }, query } })),
  timesheet: (
    projectId: number,
    query: ViewOptions & { epicId?: number; type?: WorkItemType[]; status?: WorkItemStatus[] } = {},
  ) => unwrap(http.GET('/api/projects/{projectId}/timesheet', { params: { path: { projectId }, query } })),
}

/** Phases, Epics et Stories : mêmes champs (titre, description, dates). */
export const hierarchyService = {
  createPhase: (projectId: number, body: ContainerInput) =>
    unwrap(http.POST('/api/projects/{projectId}/phases', { params: { path: { projectId } }, body })),
  updatePhase: (phaseId: number, body: ContainerUpdate) =>
    unwrap(http.PATCH('/api/phases/{phaseId}', { params: { path: { phaseId } }, body })),
  removePhase: (phaseId: number) => unwrap(http.DELETE('/api/phases/{phaseId}', { params: { path: { phaseId } } })),

  createEpic: (phaseId: number, body: ContainerInput) =>
    unwrap(http.POST('/api/phases/{phaseId}/epics', { params: { path: { phaseId } }, body })),
  updateEpic: (epicId: number, body: ContainerUpdate) =>
    unwrap(http.PATCH('/api/epics/{epicId}', { params: { path: { epicId } }, body })),
  removeEpic: (epicId: number) => unwrap(http.DELETE('/api/epics/{epicId}', { params: { path: { epicId } } })),

  createStory: (epicId: number, body: ContainerInput) =>
    unwrap(http.POST('/api/epics/{epicId}/stories', { params: { path: { epicId } }, body })),
  updateStory: (storyId: number, body: ContainerUpdate) =>
    unwrap(http.PATCH('/api/stories/{storyId}', { params: { path: { storyId } }, body })),
  removeStory: (storyId: number) => unwrap(http.DELETE('/api/stories/{storyId}', { params: { path: { storyId } } })),
}

export const milestoneService = {
  get: (milestoneId: number) => unwrap(http.GET('/api/milestones/{milestoneId}', { params: { path: { milestoneId } } })),
  create: (projectId: number, body: MilestoneInput) =>
    unwrap(http.POST('/api/projects/{projectId}/milestones', { params: { path: { projectId } }, body })),
  update: (milestoneId: number, body: MilestoneUpdate) =>
    unwrap(http.PATCH('/api/milestones/{milestoneId}', { params: { path: { milestoneId } }, body })),
  remove: (milestoneId: number) =>
    unwrap(http.DELETE('/api/milestones/{milestoneId}', { params: { path: { milestoneId } } })),
}

export const workItemService = {
  list: (projectId: number, query: { q?: string; type?: WorkItemType[]; status?: WorkItemStatus[] } = {}) =>
    unwrap(http.GET('/api/projects/{projectId}/work-items', { params: { path: { projectId }, query } })),
  get: (workItemId: number, query: ViewOptions = {}) =>
    unwrap(http.GET('/api/work-items/{workItemId}', { params: { path: { workItemId }, query } })),
  create: (storyId: number, body: WorkItemInput) =>
    unwrap(http.POST('/api/stories/{storyId}/work-items', { params: { path: { storyId } }, body })),
  createMany: (storyId: number, items: WorkItemInput[]) =>
    unwrap(http.POST('/api/stories/{storyId}/work-items/batch', { params: { path: { storyId } }, body: { items } })),
  update: (workItemId: number, body: WorkItemUpdate) =>
    unwrap(http.PATCH('/api/work-items/{workItemId}', { params: { path: { workItemId } }, body })),
  remove: (workItemId: number) =>
    unwrap(http.DELETE('/api/work-items/{workItemId}', { params: { path: { workItemId } } })),
  appendLog: (workItemId: number, body: LogEntryInput) =>
    unwrap(http.POST('/api/work-items/{workItemId}/log-entries', { params: { path: { workItemId } }, body })),
  addTime: (workItemId: number, body: TimeEntryInput) =>
    unwrap(http.POST('/api/work-items/{workItemId}/time-entries', { params: { path: { workItemId } }, body })),
  removeTime: (timeEntryId: number) =>
    unwrap(http.DELETE('/api/time-entries/{timeEntryId}', { params: { path: { timeEntryId } } })),
}

export const aiService = {
  status: () => unwrap(http.GET('/api/ai/status')),
  // signal : annule la génération (dialogue fermé, « Régénérer ») ; le backend interrompt alors Ollama.
  breakdown: (body: BreakdownInput, signal?: AbortSignal) => unwrap(http.POST('/api/ai/breakdown-story', { body, signal })),
  summarize: (body: SummarizeInput, signal?: AbortSignal) => unwrap(http.POST('/api/ai/summarize-commits', { body, signal })),
  claudePrompt: (workItemId: number) => unwrap(http.GET('/api/ai/claude/prompt', { params: { query: { workItemId } } })),
  launchClaude: (body: ClaudeLaunchInput) => unwrap(http.POST('/api/ai/claude/launch', { body })),
}

export const gitService = {
  scan: (projectId: number) => unwrap(http.POST('/api/projects/{projectId}/git/scan', { params: { path: { projectId } } })),
  hook: (projectId: number) => unwrap(http.GET('/api/projects/{projectId}/git/hook', { params: { path: { projectId } } })),
  installHook: (projectId: number) =>
    unwrap(http.PUT('/api/projects/{projectId}/git/hook', { params: { path: { projectId } } })),
  removeHook: (projectId: number) =>
    unwrap(http.DELETE('/api/projects/{projectId}/git/hook', { params: { path: { projectId } } })),
  syncGitHub: (projectId: number) =>
    unwrap(http.POST('/api/projects/{projectId}/github/sync', { params: { path: { projectId } } })),
}

/** Gantt interactif : dépendances « fin → début », déplacement d'un conteneur, replanification. */
export const scheduleService = {
  addDependency: (workItemId: number, predecessorId: number) =>
    unwrap(http.POST('/api/work-items/{workItemId}/dependencies', { params: { path: { workItemId } }, body: { predecessorId } })),
  removeDependency: (workItemId: number, predecessorId: number) =>
    unwrap(
      http.DELETE('/api/work-items/{workItemId}/dependencies/{predecessorId}', { params: { path: { workItemId, predecessorId } } }),
    ),
  resolve: (projectId: number) =>
    unwrap(http.POST('/api/projects/{projectId}/schedule/resolve', { params: { path: { projectId } } })),
  shiftPhase: (phaseId: number, days: number) =>
    unwrap(http.POST('/api/phases/{phaseId}/shift', { params: { path: { phaseId } }, body: { days } })),
  shiftEpic: (epicId: number, days: number) =>
    unwrap(http.POST('/api/epics/{epicId}/shift', { params: { path: { epicId } }, body: { days } })),
  shiftStory: (storyId: number, days: number) =>
    unwrap(http.POST('/api/stories/{storyId}/shift', { params: { path: { storyId } }, body: { days } })),
}

export const timerService = {
  get: () => unwrap(http.GET('/api/timer')),
  start: (workItemId: number) => unwrap(http.POST('/api/timer/start', { body: { workItemId } })),
  stop: (comment?: string) => unwrap(http.POST('/api/timer/stop', { body: comment ? { comment } : {} })),
  discard: () => unwrap(http.DELETE('/api/timer')),
}

export const backupService = {
  list: () => unwrap(http.GET('/api/backups')),
  create: () => unwrap(http.POST('/api/backups')),
  /** Lien de téléchargement direct (fichier SQLite). */
  downloadUrl: (name: string) => `/api/backups/${encodeURIComponent(name)}`,
}

/** Liens de téléchargement directs (le navigateur enregistre le fichier). */
export const exportService = {
  timesheetCsvUrl: (
    projectId: number,
    query: ViewOptions & { epicId?: number; type?: WorkItemType[]; status?: WorkItemStatus[] } = {},
  ) => {
    const params = new URLSearchParams()
    if (query.hoursPerDay !== undefined) params.set('hoursPerDay', String(query.hoursPerDay))
    if (query.epicId !== undefined) params.set('epicId', String(query.epicId))
    for (const type of query.type ?? []) params.append('type', type)
    for (const status of query.status ?? []) params.append('status', status)
    const search = params.toString()
    return `/api/projects/${projectId}/timesheet.csv${search ? `?${search}` : ''}`
  },
}

/**
 * Suite Atelier : import d'un fichier DataFlow d'Atelier Tab (aperçu sans écriture, puis import).
 * Pas de jeton : l'interface est de même origine que l'API (ATELIER_IMPORT_TOKEN n'est exigé que des appels externes).
 */
export const atelierTabService = {
  preview: (body: AtelierTabEnvelope, query: AtelierTabImportOptions = {}) =>
    unwrap(http.POST('/api/imports/atelier-tab/preview', { params: { query }, body })),
  /** idempotencyKey : un double envoi (double clic, nouvelle tentative) n'importe qu'une fois. */
  import: (body: AtelierTabEnvelope, query: AtelierTabImportOptions, idempotencyKey: string) =>
    unwrap(http.POST('/api/imports/atelier-tab', { params: { query, header: { 'idempotency-key': idempotencyKey } }, body })),
}
