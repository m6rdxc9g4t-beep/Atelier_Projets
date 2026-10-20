// Types métier lus dans le contrat de l'API (aucune redéfinition à la main : ils suivent le backend).
import type { paths } from './api.gen.ts'

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'
type Json<T> = T extends { content: { 'application/json': infer Body } } ? Body : never

/** Corps de la réponse de succès (200 ou 201) d'une route. */
export type ResponseOf<P extends keyof paths, M extends Method> = paths[P][M] extends { responses: infer R }
  ? R extends { 200: infer Ok }
    ? Json<Ok>
    : R extends { 201: infer Created }
      ? Json<Created>
      : never
  : never

/** Corps JSON attendu par une route. */
export type BodyOf<P extends keyof paths, M extends Method> = paths[P][M] extends {
  requestBody?: { content: { 'application/json': infer Body } }
}
  ? Body
  : never

export type Project = ResponseOf<'/api/projects/{projectId}', 'get'>
export type ProjectInput = BodyOf<'/api/projects', 'post'>
export type ProjectUpdate = BodyOf<'/api/projects/{projectId}', 'patch'>

export type Dashboard = ResponseOf<'/api/projects/{projectId}/dashboard', 'get'>
export type ProjectTree = ResponseOf<'/api/projects/{projectId}/tree', 'get'>
export type TreePhase = ProjectTree['phases'][number]
export type TreeEpic = TreePhase['epics'][number]
export type TreeStory = TreeEpic['stories'][number]
export type TreeWorkItem = TreeStory['workItems'][number]
export type Aggregate = ProjectTree['aggregate']
export type Milestone = TreePhase['milestones'][number]
export type MilestoneInput = BodyOf<'/api/projects/{projectId}/milestones', 'post'>
export type MilestoneUpdate = BodyOf<'/api/milestones/{milestoneId}', 'patch'>

export type Timesheet = ResponseOf<'/api/projects/{projectId}/timesheet', 'get'>
export type TimesheetRow = Timesheet['rows'][number]

export type WorkItemDetail = ResponseOf<'/api/work-items/{workItemId}', 'get'>
export type WorkItemInput = BodyOf<'/api/stories/{storyId}/work-items', 'post'>
export type WorkItemUpdate = BodyOf<'/api/work-items/{workItemId}', 'patch'>
export type TimeEntry = WorkItemDetail['timeEntries'][number]
export type TimeEntryInput = BodyOf<'/api/work-items/{workItemId}/time-entries', 'post'>
export type LogEntryInput = BodyOf<'/api/work-items/{workItemId}/log-entries', 'post'>
export type LinkedCommit = WorkItemDetail['commits'][number]
export type LinkedPullRequest = WorkItemDetail['pullRequests'][number]

export type ContainerInput = BodyOf<'/api/projects/{projectId}/phases', 'post'>
export type ContainerUpdate = BodyOf<'/api/phases/{phaseId}', 'patch'>

export type GitScanResult = ResponseOf<'/api/projects/{projectId}/git/scan', 'post'>
export type HookStatus = ResponseOf<'/api/projects/{projectId}/git/hook', 'get'>
export type GitHubSyncResult = ResponseOf<'/api/projects/{projectId}/github/sync', 'post'>

export type WorkItemType = WorkItemDetail['type']
export type WorkItemStatus = WorkItemDetail['status']
export type Priority = WorkItemDetail['priority']
export type Duration = WorkItemDetail['spent']
export type Balance = NonNullable<WorkItemDetail['balance']>
export type DateSpan = NonNullable<TreeWorkItem['span']>
export type Trend = NonNullable<Dashboard['trend']>

export type AppSettings = ResponseOf<'/api/settings', 'get'>
export type AppSettingsUpdate = BodyOf<'/api/settings', 'patch'>

export type AiStatus = ResponseOf<'/api/ai/status', 'get'>
export type BreakdownInput = BodyOf<'/api/ai/breakdown-story', 'post'>
export type BreakdownResult = ResponseOf<'/api/ai/breakdown-story', 'post'>
export type ProposedItem = BreakdownResult['items'][number]
/** Choix du moteur : auto (Claude si en ligne et disponible, sinon Ollama), ollama, claude. */
export type EngineChoice = NonNullable<BreakdownInput['engine']>
/** Moteur qui a effectivement répondu. */
export type AiEngine = BreakdownResult['engine']
export type ClaudeModel = NonNullable<BreakdownInput['claudeModel']>
export type SummarizeInput = BodyOf<'/api/ai/summarize-commits', 'post'>
export type SummarizeResult = ResponseOf<'/api/ai/summarize-commits', 'post'>
export type ClaudePrompt = ResponseOf<'/api/ai/claude/prompt', 'get'>
export type ClaudeLaunchInput = BodyOf<'/api/ai/claude/launch', 'post'>
export type ClaudeLaunchResult = ResponseOf<'/api/ai/claude/launch', 'post'>
export type ClaudePermissionMode = NonNullable<ClaudeLaunchInput['permissionMode']>

export type ProjectDependency = ProjectTree['dependencies'][number]
export type DependencyRef = WorkItemDetail['predecessors'][number]
export type TimerState = ResponseOf<'/api/timer', 'get'>
export type RunningTimer = NonNullable<TimerState['timer']>
export type BackupList = ResponseOf<'/api/backups', 'get'>
export type Backup = BackupList['backups'][number]

export type AtelierTabEnvelope = BodyOf<'/api/imports/atelier-tab', 'post'>
export type AtelierTabImportOptions = NonNullable<paths['/api/imports/atelier-tab']['post']['parameters']['query']>
export type AtelierTabPreview = ResponseOf<'/api/imports/atelier-tab/preview', 'post'>
export type AtelierTabImportResult = ResponseOf<'/api/imports/atelier-tab', 'post'>
export type AtelierTabImportItem = AtelierTabImportResult['items'][number]
