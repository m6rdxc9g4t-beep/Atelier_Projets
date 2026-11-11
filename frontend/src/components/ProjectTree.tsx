// Arborescence des projets de la barre latérale, sur le modèle d'Atelier Tab (Espaces › Projets › Tables) :
// Projets › Phases. Clic sur un projet : il devient le projet courant et se déplie ; chevron : déplier / replier ;
// double-clic : renommer. Actions au survol : supprimer, nouvelle phase. Au doigt (pas de survol), lignes et boutons
// de 40 px ; les actions d'un projet s'affichent sur le projet courant seulement (son nom garde la place ailleurs,
// et « Supprimer » ne se touche pas par mégarde en choisissant un projet), celles d'une phase restent affichées.
// Clic sur une phase : Gantt du projet, ouvert sur cette phase.
import { ChevronRight, FileUp, FolderClosed, FolderOpen, FolderPlus, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useAction } from '../lib/use-action.ts'
import { useApi } from '../lib/use-api.ts'
import { hierarchyService, projectService, reportService } from '../services/api.ts'
import type { Project, TreePhase } from '../services/types.ts'
import { useApp, useAppState } from '../store/app.ts'
import { TypeChip } from './ui.tsx'

/** Groupe d'actions d'une ligne : par-dessus la fin du nom, au survol ou au clavier ; dans la ligne au toucher. */
const ROW_ACTIONS =
  'pointer-events-none absolute inset-y-0 right-0 flex items-center gap-px rounded-r-md bg-hover pl-1 pr-1 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:static pointer-coarse:bg-transparent pointer-coarse:opacity-100'
const ROW_ACTION = 'grid size-6 shrink-0 place-items-center rounded-md text-faint hover:bg-selected hover:text-fg pointer-coarse:size-10 [&>svg]:size-3.5 pointer-coarse:[&>svg]:size-4'
const DELETE_ACTION = `${ROW_ACTION} hover:text-st-rejected`
/** Bouton d'en-tête de section : visible au survol de la section ou au clavier. */
const HEADER_ACTION =
  'grid size-6 shrink-0 place-items-center rounded-md text-faint opacity-0 group-hover/section:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100 pointer-coarse:size-10 pointer-coarse:opacity-100 [&>svg]:size-3.5 pointer-coarse:[&>svg]:size-4'

export function ProjectTree({ projects, current }: { projects: Project[]; current: Project | undefined }) {
  const openDialog = useApp((state) => state.openDialog)
  return (
    <section aria-label="Projets" className="group/section flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center pl-2 pr-1 pointer-coarse:h-10 pointer-coarse:pr-0">
        <h2 className="flex-1 truncate text-xs font-medium text-faint">Projets</h2>
        <button type="button" className={HEADER_ACTION} aria-label="Importer depuis Atelier Tab" title="Importer depuis Atelier Tab…" onClick={() => openDialog({ kind: 'importTab' })}>
          <FileUp />
        </button>
        <button type="button" className={HEADER_ACTION} aria-label="Nouveau projet" title="Nouveau projet" onClick={() => openDialog({ kind: 'project' })}>
          <Plus />
        </button>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pb-2">
        {projects.map((project) => (
          <ProjectRow key={project.id} project={project} active={project.id === current?.id} />
        ))}
        {projects.length === 0 && (
          <li>
            <button
              type="button"
              className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted hover:bg-hover hover:text-fg pointer-coarse:h-10"
              onClick={() => openDialog({ kind: 'project' })}
            >
              <FolderPlus className="size-4 text-faint" aria-hidden />
              Nouveau projet
            </button>
          </li>
        )}
      </ul>
    </section>
  )
}

function ProjectRow({ project, active }: { project: Project; active: boolean }) {
  const { expanded, toggleProjectTree, setProject, openDialog } = useAppState((state) => ({
    expanded: state.expandedProjectIds.includes(project.id),
    toggleProjectTree: state.toggleProjectTree,
    setProject: state.setProject,
    openDialog: state.openDialog,
  }))
  const [renaming, setRenaming] = useState(false)
  const { run } = useAction()
  const Folder = expanded ? FolderOpen : FolderClosed

  const rename = async (name: string | null) => {
    setRenaming(false)
    if (!name || name === project.name) return
    await run('rename', () => projectService.update(project.id, { name }), `Projet renommé « ${name} »`)
  }

  return (
    <li>
      <div className={`group relative flex items-center rounded-md ${active ? 'bg-selected' : 'hover:bg-hover'}`}>
        <button
          type="button"
          className="grid h-[30px] w-6 shrink-0 place-items-center text-faint hover:text-fg pointer-coarse:h-10 pointer-coarse:w-8"
          aria-label={expanded ? `Replier ${project.name}` : `Déplier ${project.name}`}
          aria-expanded={expanded}
          onClick={() => toggleProjectTree(project.id)}
        >
          <ChevronRight className={`size-3.5 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} aria-hidden />
        </button>
        {renaming ? (
          <div className="flex h-[30px] min-w-0 flex-1 items-center gap-2 pr-1 pointer-coarse:h-10">
            <Folder className="size-4 shrink-0 text-faint" aria-hidden />
            <RenameInput value={project.name} label="Nom du projet" onDone={rename} />
          </div>
        ) : (
          <button
            type="button"
            aria-current={active ? 'true' : undefined}
            title="Double-cliquez pour renommer"
            className={`flex h-[30px] min-w-0 flex-1 items-center gap-2 pr-2 text-left text-sm font-medium pointer-coarse:h-10 ${active ? 'text-fg' : 'text-muted hover:text-fg'}`}
            onClick={() => {
              setProject(project.id)
              toggleProjectTree(project.id, true)
            }}
            onDoubleClick={() => setRenaming(true)}
          >
            <Folder className={`size-4 shrink-0 ${active ? 'text-fg' : 'text-faint'}`} aria-hidden />
            <span className="truncate">{project.name}</span>
          </button>
        )}
        {!renaming && (
          <div className={`${ROW_ACTIONS} ${active ? '' : 'pointer-coarse:hidden'}`}>
            <button type="button" className={DELETE_ACTION} aria-label={`Supprimer le projet ${project.name}`} title="Supprimer le projet" onClick={() => openDialog({ kind: 'deleteProject', projectId: project.id })}>
              <Trash2 />
            </button>
            <button
              type="button"
              className={ROW_ACTION}
              aria-label={`Nouvelle phase dans ${project.name}`}
              title="Nouvelle phase"
              onClick={() => {
                // Le dialogue de phase crée dans le projet courant.
                setProject(project.id)
                toggleProjectTree(project.id, true)
                openDialog({ kind: 'phase' })
              }}
            >
              <Plus />
            </button>
          </div>
        )}
      </div>
      {expanded && <PhaseList project={project} />}
    </li>
  )
}

function PhaseList({ project }: { project: Project }) {
  const tree = useApi(() => reportService.tree(project.id), [project.id])
  const phases = tree.data?.phases

  return (
    <ul className="mt-px flex flex-col gap-px pl-6" aria-label={`Phases de ${project.name}`}>
      {!phases && !tree.error && <li className="flex h-7 items-center px-2 text-xs text-faint">Chargement…</li>}
      {tree.error && <li className="flex h-7 items-center px-2 text-xs text-st-rejected">Phases illisibles</li>}
      {phases?.map((phase) => (
        <PhaseRow key={phase.id} project={project} phase={phase} />
      ))}
      {phases?.length === 0 && <li className="flex h-7 items-center px-2 text-xs text-faint">Aucune phase</li>}
    </ul>
  )
}

function PhaseRow({ project, phase }: { project: Project; phase: TreePhase }) {
  const { showPhase, openDialog } = useAppState((state) => ({ showPhase: state.showPhase, openDialog: state.openDialog }))
  const [renaming, setRenaming] = useState(false)
  const { run } = useAction()

  const rename = async (title: string | null) => {
    setRenaming(false)
    if (!title || title === phase.title) return
    await run('rename', () => hierarchyService.updatePhase(phase.id, { title }), 'Phase renommée')
  }

  return (
    <li className="group relative flex items-center rounded-md hover:bg-hover">
      {renaming ? (
        <div className="flex h-7 min-w-0 flex-1 items-center gap-2 px-2 pointer-coarse:h-10">
          <TypeChip type="PHASE" />
          <RenameInput value={phase.title} label="Titre de la phase" onDone={rename} />
        </div>
      ) : (
        <button
          type="button"
          title={`${phase.code} : ${phase.title} — double-cliquez pour renommer`}
          className="flex h-7 min-w-0 flex-1 items-center gap-2 px-2 text-left text-[13px] text-muted hover:text-fg pointer-coarse:h-10"
          onClick={() => showPhase(project.id, phase.id)}
          onDoubleClick={() => setRenaming(true)}
        >
          <TypeChip type="PHASE" />
          <span className="min-w-0 flex-1 truncate">{phase.title}</span>
          <span className="text-xs tabular-nums text-faint group-hover:opacity-0 pointer-coarse:group-hover:opacity-100" aria-label={`${phase.aggregate.workItems} éléments`}>
            {phase.aggregate.workItems}
          </span>
        </button>
      )}
      {!renaming && (
        <div className={ROW_ACTIONS}>
          <button
            type="button"
            className={DELETE_ACTION}
            aria-label={`Supprimer la phase ${phase.title}`}
            title="Supprimer la phase"
            onClick={() => openDialog({ kind: 'deletePhase', projectId: project.id, phaseId: phase.id })}
          >
            <Trash2 />
          </button>
        </div>
      )}
    </li>
  )
}

/** Renommage en place : Entrée valide, Échap annule (et ne ferme pas la fiche ouverte derrière). */
function RenameInput({ value, label, onDone }: { value: string; label: string; onDone: (value: string | null) => void }) {
  return (
    <input
      autoFocus
      defaultValue={value}
      aria-label={label}
      maxLength={200}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => onDone(event.currentTarget.value.trim() || null)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.value = value
          event.currentTarget.blur()
        }
      }}
      className="h-6 min-w-0 flex-1 rounded-md border border-accent bg-field px-1.5 text-sm text-fg outline-none pointer-coarse:h-10"
    />
  )
}
