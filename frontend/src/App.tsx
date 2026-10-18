// Application : choix du projet, cadre (en-tête, rail, onglets), vue courante, fiche tâche et dialogues.
import { FolderPlus, PlugZap } from 'lucide-react'
import { useEffect } from 'react'
import { Dialogs } from './components/Dialogs.tsx'
import { Header, Rail, Toasts, ViewTabs } from './components/shell.tsx'
import { Button, EmptyState, ErrorNotice, Spinner } from './components/ui.tsx'
import { useApi } from './lib/use-api.ts'
import { ApiError } from './services/client.ts'
import { projectService } from './services/api.ts'
import type { Project } from './services/types.ts'
import { useApp, useAppState } from './store/app.ts'
import { DashboardView } from './views/DashboardView.tsx'
import { GanttView } from './views/GanttView.tsx'
import { SettingsView } from './views/SettingsView.tsx'
import { TaskSlideOver } from './views/TaskSlideOver.tsx'
import { TimeSheetView } from './views/TimeSheetView.tsx'

export function App() {
  const { theme, projectId, setProject, view, selectedWorkItemId } = useAppState((state) => ({
    theme: state.theme,
    projectId: state.projectId,
    setProject: state.setProject,
    view: state.view,
    selectedWorkItemId: state.selectedWorkItemId,
  }))
  const projects = useApi(() => projectService.list(), [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Aucun choix, ou projet absent de la liste : s'il vient d'être créé, la liste est relue ; s'il a été
  // supprimé (404), le premier projet de la liste est choisi.
  const list = projects.data
  const reloadProjects = projects.reload
  useEffect(() => {
    if (!list || list.some((candidate) => candidate.id === projectId)) return
    const fallback = () => setProject(list[0]?.id ?? null)
    if (projectId === null) return fallback()
    let cancelled = false
    projectService.get(projectId).then(
      () => !cancelled && reloadProjects(),
      () => !cancelled && fallback(),
    )
    return () => {
      cancelled = true
    }
  }, [list, projectId, setProject, reloadProjects])

  const project = list?.find((candidate) => candidate.id === projectId)

  if (projects.error instanceof ApiError && projects.error.unreachable) {
    return <BackendDown onRetry={projects.reload} />
  }

  return (
    <div className="flex h-full flex-col">
      <Header projects={list ?? []} project={project} />
      <div className="flex min-h-0 flex-1">
        <Rail />
        <main className="flex min-w-0 flex-1 flex-col">
          <ViewTabs />
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-6">
              {projects.error && <ErrorNotice error={projects.error} onRetry={projects.reload} />}
              {!list && !projects.error && <Spinner />}
              {list && list.length === 0 && <NoProject />}
              {project && <CurrentView key={project.id} project={project} view={view} />}
            </div>
          </div>
        </main>
        {project && selectedWorkItemId !== null && <TaskSlideOver key={selectedWorkItemId} workItemId={selectedWorkItemId} project={project} />}
      </div>
      <Dialogs project={project} />
      <Toasts />
    </div>
  )
}

function CurrentView({ project, view }: { project: Project; view: ReturnType<typeof useApp.getState>['view'] }) {
  switch (view) {
    case 'dashboard':
      return <DashboardView project={project} />
    case 'timesheet':
      return <TimeSheetView project={project} />
    case 'settings':
      return <SettingsView project={project} />
    default:
      return <GanttView project={project} />
  }
}

function NoProject() {
  const openDialog = useApp((state) => state.openDialog)
  return (
    <EmptyState icon={<FolderPlus className="size-10" />} title="Aucun projet pour l’instant">
      <p className="mb-4">Créez un projet, ou insérez la démo « App E-Commerce v2 » avec npm run db:seed.</p>
      <Button variant="primary" icon={<FolderPlus className="size-4" />} onClick={() => openDialog({ kind: 'project' })}>
        Nouveau projet
      </Button>
    </EmptyState>
  )
}

function BackendDown({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="ds-card max-w-lg p-8 text-center">
        <PlugZap className="mx-auto mb-4 size-10 text-muted" aria-hidden />
        <h1 className="mb-2 text-lg font-semibold">Le backend ne répond pas</h1>
        <p className="mb-4 text-muted">L’interface a besoin de l’API locale. À la racine du projet, lancer :</p>
        <pre className="mb-5 rounded-md bg-sunken px-4 py-3 text-left font-mono text-sm">npm run dev</pre>
        <Button variant="primary" onClick={onRetry}>
          Réessayer
        </Button>
      </div>
    </div>
  )
}
