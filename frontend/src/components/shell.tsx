// Cadre de l'application, à la forme du portail de la suite (charte v2 « Linear », Atelier_Deploy/DESIGN.md) :
// barre latérale (marque, sélecteur de la suite, projet, vues, exemples de la suite, thème), barre haute de 44 px
// (titre de la vue, chronomètre, IA), notifications. Sous 768 px, la barre latérale devient un bandeau et les vues
// une rangée de pastilles.
import {
  BookOpen,
  Bot,
  CalendarRange,
  Check,
  ChevronsUpDown,
  CircleHelp,
  Clock3,
  FolderPlus,
  LayoutDashboard,
  Link2,
  FileUp,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Sun,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { githubLabel } from '../lib/format.ts'
import { useShallow } from 'zustand/react/shallow'
import { CLAUDE_MODEL_LABEL, ollamaReady, safeClaudeModel } from '../lib/engine.ts'
import type { Project } from '../services/types.ts'
import { useAi } from '../store/ai.ts'
import { useApp, useAppState, type Theme, type ViewId } from '../store/app.ts'
import { OnlineSwitch } from './AiDialogs.tsx'
import { ProjectTree } from './ProjectTree.tsx'
import { AtelierBrand } from './AtelierBrand.tsx'
import { SuiteSwitcher } from './SuiteSwitcher.tsx'
import { TimerPill } from './Timer.tsx'
import { Button } from './ui.tsx'

export const VIEWS: { id: ViewId; label: string; short: string; icon: ReactNode }[] = [
  { id: 'dashboard', label: 'Tableau de bord', short: 'Tableau de bord', icon: <LayoutDashboard /> },
  { id: 'gantt', label: 'Gantt & Avancement du projet', short: 'Gantt', icon: <CalendarRange /> },
  { id: 'timesheet', label: 'Tableau des temps', short: 'Temps', icon: <Clock3 /> },
  { id: 'settings', label: 'Paramètres du projet', short: 'Paramètres', icon: <Settings /> },
]

/**
 * IA dans l'en-tête (docs/SUITE.md §5) : interrupteur « Hors ligne / En ligne », pastilles « Ollama » et « Claude »
 * (vert = disponible, gris = indisponible ou hors ligne, détail dans l'info-bulle) et bouton du panneau IA.
 */
function AiControls() {
  const { aiModel, claudeModel, openDialog } = useAppState((state) => ({ aiModel: state.aiModel, claudeModel: state.claudeModel, openDialog: state.openDialog }))
  const { status, error, load } = useAi(useShallow((state) => ({ status: state.status, error: state.error, load: state.load })))
  // État relu au retour sur la fenêtre (Ollama lancé, CLI connectée entre-temps).
  useEffect(() => {
    void load()
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const ollama = status?.ollama
  const model = aiModel ?? ollama?.defaultModelName ?? ollama?.defaultModel
  const ollamaOk = ollamaReady(status, aiModel)
  const ollamaTitle = !ollama
    ? (error ?? 'Vérification…')
    : ollamaOk
      ? `Ollama connecté · modèle ${model}`
      : ollama.reachable
        ? `Ollama connecté, modèle « ${model} » absent (ollama pull ${model})`
        : `Ollama injoignable : ${ollama.error ?? ollama.url}`
  const claude = status?.claude
  const claudeOk = claude?.available === true
  const claudeTitle = !status
    ? (error ?? 'Vérification…')
    : !status.onlineMode
      ? 'Claude : désactivé (mode hors ligne)'
      : claudeOk
        ? `Claude disponible · ${CLAUDE_MODEL_LABEL[safeClaudeModel(claudeModel)]}${claude?.version ? ` · CLI ${claude.version}` : ''}`
        : `Claude indisponible : ${claude?.error ?? 'voir le panneau IA'}`

  return (
    <>
      <OnlineSwitch />
      <div className="hidden items-center gap-1 lg:flex" role="group" aria-label="État des moteurs d’IA">
        <EnginePill label="Ollama" ok={ollamaOk} title={ollamaTitle} onClick={() => openDialog({ kind: 'ai' })} />
        <EnginePill label="Claude" ok={claudeOk} title={claudeTitle} onClick={() => openDialog({ kind: 'ai' })} />
      </div>
      <AiButton />
    </>
  )
}

function EnginePill({ label, ok, title, onClick }: { label: string; ok: boolean; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={`${label} : ${ok ? 'disponible' : 'indisponible'} — ${title}`}
      onClick={onClick}
      className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-fg pointer-coarse:h-10"
    >
      <span className="ds-dot" data-status={ok ? 'CLOSED' : 'OPEN'} aria-hidden />
      {label}
    </button>
  )
}

/** Bouton du panneau IA (moteurs, modèles, session Claude CLI). */
function AiButton() {
  const openDialog = useApp((state) => state.openDialog)
  return (
    <Button variant="primary" size="sm" icon={<Bot />} title="Intelligence artificielle : moteurs, modèles, session Claude CLI" onClick={() => openDialog({ kind: 'ai' })}>
      IA
    </Button>
  )
}

/**
 * Barre latérale (≥ 768 px : colonne de 232 px, ou 52 px repliée ; en dessous : bandeau en haut).
 * Haut : marque (« À propos »), sélecteur de la suite ; puis vues du projet courant, arborescence des projets
 * (Projets › Phases, comme la barre d'Atelier Tab) ; pied : « Exemples de la suite », documentation de l'API, thème.
 * Repliée ou sur téléphone, l'arborescence laisse la place au menu déroulant des projets ; sur téléphone, où le
 * pied ne garde que le thème, ce menu porte aussi « Exemples de la suite ».
 */
export function Sidebar({ projects, project }: { projects: Project[]; project: Project | undefined }) {
  const { railExpanded, openDialog } = useAppState((state) => ({ railExpanded: state.railExpanded, openDialog: state.openDialog }))
  const collapsed = !railExpanded

  return (
    <div
      className={`ds-chrome flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3.5 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] md:h-full md:flex-col md:flex-nowrap md:items-stretch md:gap-0 md:border-b-0 md:border-r md:px-2 md:pb-2 md:pt-3 ${
        collapsed ? 'md:w-[52px]' : 'md:w-[var(--side-w)]'
      }`}
    >
      {/* En-tête de la barre latérale (rôle « groupe » : la bannière de la page est la barre haute). Sur téléphone,
          display: contents laisse la marque et le projet se ranger dans le bandeau. */}
      <header role="group" aria-label="Application et projet" className="contents md:flex md:flex-col">
        <div className={`flex min-w-0 flex-1 items-center gap-1 md:flex-none ${collapsed ? 'md:flex-col md:gap-2' : 'md:px-1'}`}>
          <AtelierBrand nameClassName={collapsed ? 'md:hidden' : ''} />
          <div className={`ml-auto ${collapsed ? 'md:ml-0' : ''}`}>
            <SuiteSwitcher />
          </div>
        </div>

        <div className={`order-3 w-full md:order-none md:mt-3 ${collapsed ? 'md:flex md:justify-center' : 'md:hidden'}`}>
          <ProjectSwitcher projects={projects} project={project} compact={collapsed} />
        </div>
      </header>

      <nav
        aria-label="Navigation principale"
        className={`order-4 -mx-3.5 flex w-[calc(100%+1.75rem)] min-w-0 gap-1 overflow-x-auto px-3.5 [scrollbar-width:none] md:order-none md:mx-0 md:mt-3 md:w-auto md:flex-col ${collapsed ? 'md:flex-1' : 'md:flex-none'} md:gap-px md:overflow-x-visible md:overflow-y-auto md:px-0`}
      >
        <ViewTabs collapsed={collapsed} />
        <button
          type="button"
          className={`${NAV_ITEM} hidden md:flex`}
          title={collapsed ? 'Ajouter une phase' : undefined}
          onClick={() => openDialog({ kind: 'phase' })}
        >
          <Plus aria-hidden />
          {collapsed ? <span className="sr-only">Ajouter une phase</span> : <span className="truncate">Nouvelle phase</span>}
        </button>
      </nav>

      {!collapsed && (
        <div className="hidden md:mt-4 md:flex md:min-h-0 md:flex-1 md:flex-col">
          <ProjectTree projects={projects} current={project} />
        </div>
      )}

      <div className={`order-2 flex items-center gap-1 md:order-none md:mt-2 md:flex-col md:items-stretch md:gap-1.5 md:pt-2 ${collapsed ? 'md:items-center' : ''}`}>
        <div className="hidden md:flex md:flex-col md:gap-px md:self-stretch">
          <button
            type="button"
            className={NAV_ITEM}
            aria-haspopup="dialog"
            title={collapsed ? EXAMPLES_LABEL : undefined}
            onClick={(event) => openExamples(event.currentTarget)}
          >
            <BookOpen aria-hidden />
            <span className={collapsed ? 'sr-only' : 'truncate'}>{EXAMPLES_LABEL}</span>
          </button>
          <a className={NAV_ITEM} href="/api/docs" target="_blank" rel="noreferrer" title={collapsed ? 'Documentation de l’API' : undefined}>
            <CircleHelp aria-hidden />
            {collapsed ? <span className="sr-only">Documentation de l’API</span> : <span className="truncate">Documentation API</span>}
          </a>
        </div>
        <ThemeSwitch vertical={collapsed} />
      </div>
    </div>
  )
}

const EXAMPLES_LABEL = 'Exemples de la suite'

/**
 * Ouvre la fenêtre « Exemples de la suite ». Le focus est d'abord posé sur `trigger` : la fenêtre le lui rend à sa
 * fermeture, même quand le clic ne l'a pas focalisé (Safari) ou qu'il vient d'une entrée de menu qui disparaît.
 */
function openExamples(trigger: HTMLElement | null) {
  trigger?.focus()
  useApp.getState().openDialog({ kind: 'examples' })
}

/** Entrée de navigation : 30 px (40 px au doigt), icône 16 px discrète, libellé 13 px en 500 ; pastille bordée sur téléphone. */
const NAV_ITEM =
  'flex h-[30px] shrink-0 pointer-coarse:h-10 items-center gap-2.5 whitespace-nowrap rounded-full border border-line px-2.5 text-left text-sm font-medium text-fg transition-colors hover:bg-hover md:rounded-md md:border-0 md:px-2 [&>svg]:hidden [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-faint md:[&>svg]:block'

/**
 * Vues du projet : onglets (tablist) disposés en colonne dans la barre latérale, en rangée sur téléphone.
 * Nom accessible = libellé complet de la vue (« Tableau des temps ») ; libellé court affiché.
 */
export function ViewTabs({ collapsed }: { collapsed: boolean }) {
  const { view, setView } = useAppState((state) => ({ view: state.view, setView: state.setView }))
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key]
    if (step === undefined) return
    event.preventDefault()
    const index = VIEWS.findIndex((entry) => entry.id === view)
    const next = VIEWS[(index + step + VIEWS.length) % VIEWS.length]
    if (!next) return
    setView(next.id)
    event.currentTarget.querySelector<HTMLElement>(`[data-view="${next.id}"]`)?.focus()
  }
  return (
    <div role="tablist" aria-label="Vues du projet" aria-orientation="vertical" className="flex gap-1 md:flex-col md:gap-px" onKeyDown={onKeyDown}>
      {VIEWS.map((entry) => {
        const active = entry.id === view
        return (
          <button
            key={entry.id}
            type="button"
            role="tab"
            data-view={entry.id}
            aria-selected={active}
            aria-label={entry.label}
            tabIndex={active ? 0 : -1}
            title={collapsed ? entry.label : undefined}
            className={`${NAV_ITEM} ${active ? 'border-transparent bg-selected md:[&>svg]:text-fg' : ''}`}
            onClick={() => setView(entry.id)}
          >
            {entry.icon}
            <span className={collapsed ? 'md:sr-only' : 'truncate'}>{entry.short}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Barre haute (44 px) : repli de la barre latérale, titre de la vue, dépôt GitHub, chronomètre et IA. */
export function TopBar({ project }: { project: Project | undefined }) {
  const { view, railExpanded, toggleRail } = useAppState((state) => ({ view: state.view, railExpanded: state.railExpanded, toggleRail: state.toggleRail }))
  const github = githubLabel(project?.github)
  const title = VIEWS.find((entry) => entry.id === view)?.label

  return (
    <header className="flex min-h-[var(--top-h)] shrink-0 items-center gap-2 border-b border-line bg-main px-3.5 md:gap-3 md:px-4 pointer-coarse:py-1">
      <Button
        variant="ghost"
        size="sm"
        className="hidden shrink-0 md:inline-flex"
        icon={railExpanded ? <PanelLeftClose /> : <PanelLeftOpen />}
        aria-label="Afficher ou masquer les libellés du menu"
        title={railExpanded ? 'Replier la barre latérale' : 'Déplier la barre latérale'}
        onClick={toggleRail}
      />
      {project && title && (
        <h1 className="hidden min-w-0 items-center gap-1.5 text-sm font-semibold md:flex">
          <span className="truncate font-medium text-muted">{project.name}</span>
          <span className="text-faint" aria-hidden>
            /
          </span>
          <span className="truncate">{title}</span>
        </h1>
      )}
      {github && project?.github && (
        <a
          href={project.github.url}
          target="_blank"
          rel="noreferrer"
          className="hidden min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-hover hover:text-fg lg:flex"
        >
          <Link2 className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{github}</span>
        </a>
      )}
      {/* Seul le titre cède la place (tronqué) : les commandes de droite ne rétrécissent pas, sinon « IA » sort de l'écran. */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 md:gap-2">
        <TimerPill />
        <AiControls />
      </div>
    </header>
  )
}

const THEMES: { id: Theme; label: string; icon: ReactNode }[] = [
  { id: 'system', label: 'Thème du système', icon: <Monitor /> },
  { id: 'light', label: 'Thème clair', icon: <Sun /> },
  { id: 'dark', label: 'Thème sombre', icon: <Moon /> },
]

/** Choix du thème (Système / Clair / Sombre), commun à toute la suite. */
function ThemeSwitch({ vertical }: { vertical: boolean }) {
  const { theme, setTheme } = useAppState((state) => ({ theme: state.theme, setTheme: state.setTheme }))
  return (
    <div className={`ds-seg md:self-start ${vertical ? 'md:flex-col md:self-center' : 'md:ml-1'}`} role="group" aria-label="Thème">
      {THEMES.map((option) => (
        <button key={option.id} type="button" aria-label={option.label} title={option.label} aria-pressed={theme === option.id} onClick={() => setTheme(option.id)}>
          {option.icon}
        </button>
      ))}
    </div>
  )
}

function ProjectSwitcher({ projects, project, compact }: { projects: Project[]; project: Project | undefined; compact: boolean }) {
  const [open, setOpen] = useState(false)
  const { setProject, openDialog } = useAppState((state) => ({ setProject: state.setProject, openDialog: state.openDialog }))
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    // Phase de capture + preventDefault : Échap ferme le menu seul, pas la fiche élément ouverte derrière.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const name = project?.name ?? 'Choisir un projet'
  return (
    <div className={`relative min-w-0 ${compact ? '' : 'w-full'}`} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`flex h-8 pointer-coarse:h-10 w-full min-w-0 items-center gap-2 rounded-md border border-line bg-surface pl-2 pr-1.5 text-left text-sm font-medium transition-colors hover:bg-hover ${
          compact ? 'md:size-8 md:justify-center md:p-0' : ''
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={compact ? name : undefined}
        title={compact ? name : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="grid size-5 shrink-0 place-items-center rounded bg-selected text-[11px] font-semibold text-fg" aria-hidden>
          {name.trim().charAt(0).toUpperCase()}
        </span>
        <span className={`min-w-0 flex-1 truncate ${compact ? 'md:hidden' : ''}`}>{name}</span>
        <ChevronsUpDown className={`size-3.5 shrink-0 text-faint ${compact ? 'md:hidden' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="ds-card absolute left-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-1.75rem)] overflow-hidden p-1 shadow-overlay">
          <ul role="listbox" aria-label="Projets" className="max-h-80 overflow-y-auto">
            {projects.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={candidate.id === project?.id}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover pointer-coarse:h-10"
                  onClick={() => {
                    setProject(candidate.id)
                    setOpen(false)
                  }}
                >
                  <span className="grid size-4 place-items-center text-accent-ink">
                    {candidate.id === project?.id && <Check className="size-4" aria-hidden />}
                  </span>
                  <span className="truncate">{candidate.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t border-line pt-1">
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover pointer-coarse:h-10"
              onClick={() => {
                setOpen(false)
                openDialog({ kind: 'project' })
              }}
            >
              <FolderPlus className="size-4 text-faint" aria-hidden />
              Nouveau projet
            </button>
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover pointer-coarse:h-10"
              onClick={() => {
                setOpen(false)
                openDialog({ kind: 'importTab' })
              }}
            >
              <FileUp className="size-4 text-faint" aria-hidden />
              Importer depuis Atelier Tab…
            </button>
            {/* Téléphone seulement : à partir de 768 px, l'entrée est au pied de la barre latérale. */}
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover pointer-coarse:h-10 md:hidden"
              aria-haspopup="dialog"
              onClick={() => {
                setOpen(false)
                openExamples(trigger.current)
              }}
            >
              <BookOpen className="size-4 text-faint" aria-hidden />
              {EXAMPLES_LABEL}…
            </button>
            {project && (
              <button
                type="button"
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover pointer-coarse:h-10"
                onClick={() => {
                  setOpen(false)
                  openDialog({ kind: 'deleteProject', projectId: project.id })
                }}
              >
                <Trash2 className="size-4 text-st-rejected" aria-hidden />
                <span className="truncate">Supprimer « {project.name} »…</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function Toasts() {
  const { toasts, dismiss } = useAppState((state) => ({ toasts: state.toasts, dismiss: state.dismiss }))
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          data-status={toast.tone === 'error' ? 'REJECTED' : toast.tone === 'success' ? 'CLOSED' : 'IN_PROGRESS'}
          className="ds-card pointer-events-auto flex items-start gap-2.5 px-3 py-2.5 shadow-overlay"
        >
          <span className="ds-dot mt-[0.3rem]" aria-hidden />
          <p className="flex-1 leading-snug">{toast.message}</p>
          <button type="button" className="grid size-5 place-items-center rounded text-muted hover:bg-hover hover:text-fg pointer-coarse:-m-2.5 pointer-coarse:size-10" aria-label="Fermer la notification" onClick={() => dismiss(toast.id)}>
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
