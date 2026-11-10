// Confirmation avant de supprimer un projet ou une phase (irréversible), avec ce qui part avec :
// phases, epics, éléments, temps saisis, jalons — lus dans l'arborescence calculée par le backend.
import { Trash2 } from 'lucide-react'
import { daysAndHours } from '../lib/format.ts'
import { useAction } from '../lib/use-action.ts'
import { useApi } from '../lib/use-api.ts'
import { hierarchyService, projectService, reportService } from '../services/api.ts'
import type { Project } from '../services/types.ts'
import { useApp, type DialogRequest } from '../store/app.ts'
import { Button, Modal, Spinner } from './ui.tsx'

type DeleteRequest = Extract<DialogRequest, { kind: 'deleteProject' | 'deletePhase' }>

const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`
const close = () => useApp.getState().openDialog(null)

export function DeleteDialog({ request, projects }: { request: DeleteRequest; projects: Project[] }) {
  const tree = useApi(() => reportService.tree(request.projectId), [request.projectId])
  const { busy, run } = useAction()
  const project = projects.find((candidate) => candidate.id === request.projectId)
  const phase = request.kind === 'deletePhase' ? tree.data?.phases.find((candidate) => candidate.id === request.phaseId) : undefined

  const name = request.kind === 'deleteProject' ? (project?.name ?? '') : (phase?.title ?? '')
  const title = request.kind === 'deleteProject' ? `Supprimer le projet « ${name} » ?` : `Supprimer la phase « ${name} » ?`

  let detail: string | null = null
  if (tree.data && request.kind === 'deleteProject') {
    const { phases, aggregate, milestones } = tree.data
    const allMilestones = milestones.length + phases.reduce((sum, candidate) => sum + candidate.milestones.length, 0)
    detail =
      `${plural(phases.length, 'phase', 'phases')}, ${plural(aggregate.workItems, 'élément', 'éléments')}, ` +
      `${plural(allMilestones, 'jalon', 'jalons')} et ${daysAndHours(aggregate.spent)} de temps saisi seront supprimés, ` +
      'ainsi que les liens Git et GitHub du projet.'
  } else if (phase) {
    detail =
      `${plural(phase.epics.length, 'epic', 'epics')}, ${plural(phase.aggregate.workItems, 'élément', 'éléments')}, ` +
      `${plural(phase.milestones.length, 'jalon', 'jalons')} et ${daysAndHours(phase.aggregate.spent)} de temps saisi seront supprimés.`
  }

  const confirm = async () => {
    if (request.kind === 'deleteProject') {
      const result = await run('delete', () => projectService.remove(request.projectId), `Projet « ${name} » supprimé`)
      if (!result.ok) return
      const state = useApp.getState()
      state.toggleProjectTree(request.projectId, false)
      // Projet courant supprimé : le suivant de la liste prend sa place.
      if (state.projectId === request.projectId) state.setProject(projects.find((candidate) => candidate.id !== request.projectId)?.id ?? null)
    } else {
      const result = await run('delete', () => hierarchyService.removePhase(request.phaseId), `Phase « ${name} » supprimée`)
      if (!result.ok) return
      if (useApp.getState().focusPhaseId === request.phaseId) useApp.getState().clearFocusPhase()
    }
    close()
  }

  const missing = (request.kind === 'deleteProject' && !project) || (request.kind === 'deletePhase' && tree.data && !phase)

  return (
    <Modal
      title={missing ? 'Élément introuvable' : title}
      onClose={close}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Annuler
          </Button>
          {!missing && (
            <Button variant="danger" icon={<Trash2 className="size-3.5" />} busy={busy === 'delete'} disabled={!tree.data && !tree.error} onClick={confirm}>
              Supprimer
            </Button>
          )}
        </>
      }
    >
      {missing ? (
        <p>Il a déjà été supprimé.</p>
      ) : (
        <div className="space-y-2 text-sm">
          {detail ? <p>{detail}</p> : tree.error ? <p className="text-muted">Le contenu n’a pas pu être lu ; il sera supprimé avec.</p> : <Spinner />}
          <p className="text-muted">
            Cette action est définitive. Pour garder une copie, faites d’abord une sauvegarde de la base (Paramètres du projet › Sauvegardes de la base).
          </p>
        </div>
      )}
    </Modal>
  )
}
