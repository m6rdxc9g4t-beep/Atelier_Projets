// Cadre de l'application (maquette du README §4) : en-tête, rail de navigation, onglets, notifications.
import {
  Bot,
  CalendarRange,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  FolderPlus,
  LayoutDashboard,
  Link2,
  Menu,
  Moon,
  Plus,
  Rocket,
  Settings,
  Sun,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { githubLabel } from '../lib/format.ts'
import { useApi } from '../lib/use-api.ts'
import { aiService } from '../services/api.ts'
import type { Project } from '../services/types.ts'
import { useAppState, type ViewId } from '../store/app.ts'
import { TimerPill } from './Timer.tsx'
import { Button, Tabs } from './ui.tsx'

export const VIEWS: { id: ViewId; label: string; short: string; icon: ReactNode }[] = [
  { id: 'dashboard', label: 'Tableau de bord', short: 'Tableau de bord', icon: <LayoutDashboard className="size-5" /> },
  { id: 'gantt', label: 'Gantt & Avancement du projet', short: 'Gantt', icon: <CalendarRange className="size-5" /> },
  { id: 'timesheet', label: 'Tableau des temps', short: 'Temps', icon: <Clock3 className="size-5" /> },
  { id: 'settings', label: 'Paramètres du projet', short: 'Paramètres', icon: <Settings className="size-5" /> },
]

/** Bouton « IA Locale » : pastille verte si Ollama répond avec le modèle choisi, orange sans modèle, rouge injoignable. */
function AiButton() {
  const { aiModel, openDialog, dialog } = useAppState((state) => ({ aiModel: state.aiModel, openDialog: state.openDialog, dialog: state.dialog }))
  const status = useApi(() => aiService.status(), [dialog?.kind === 'ai'], { followRevision: false })
  const ollama = status.data?.ollama
  const model = aiModel ?? ollama?.defaultModelName ?? ollama?.defaultModel
  const ready = ollama?.reachable === true && (aiModel === null ? ollama.defaultModelInstalled : ollama.models.some((candidate) => candidate.name === aiModel))
  const tone = !ollama ? null : ready ? 'CLOSED' : ollama.reachable ? 'ON_HOLD' : 'REJECTED'
  const title = !ollama
    ? 'IA locale (Ollama) et Claude CLI'
    : ready
      ? `Ollama connecté · modèle ${model}`
      : ollama.reachable
        ? `Ollama connecté, modèle « ${model} » absent`
        : 'Ollama injoignable'
  return (
    <Button variant="primary" icon={<Bot className="size-4" />} title={title} className="hidden sm:inline-flex" onClick={() => openDialog({ kind: 'ai' })}>
      IA Locale
      {tone && <span className="ds-dot" data-status={tone} aria-label={title} />}
    </Button>
  )
}

export function Header({ projects, project }: { projects: Project[]; project: Project | undefined }) {
  const { theme, setTheme, toggleRail } = useAppState((state) => ({ theme: state.theme, setTheme: state.setTheme, toggleRail: state.toggleRail }))
  const github = githubLabel(project?.github)

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 sm:gap-3 border-b border-line bg-surface px-3 sm:px-4">
      <Button variant="ghost" icon={<Menu className="size-5" />} aria-label="Afficher ou masquer les libellés du menu" onClick={toggleRail} />
      <div className="flex items-center gap-2 pr-1">
        <Rocket className="size-5 text-accent-ink" aria-hidden />
        <span className="hidden text-[15px] font-extrabold tracking-wide sm:inline">ATELIER_PROJETS</span>
      </div>
      <ProjectSwitcher projects={projects} project={project} />
      {github && project?.github && (
        <a
          href={project.github.url}
          target="_blank"
          rel="noreferrer"
          className="hidden items-center gap-1.5 truncate rounded-md px-2 py-1 text-accent-ink hover:bg-hover md:flex"
        >
          <Link2 className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{github}</span>
        </a>
      )}
      <div className="ml-auto flex items-center gap-2">
        <TimerPill />
        <div className="flex items-center rounded-lg border border-line bg-sunken p-0.5" role="group" aria-label="Thème">
          <ThemeButton active={theme === 'light'} onClick={() => setTheme('light')} label="Thème clair" icon={<Sun className="size-4" />} />
          <span className="px-0.5 text-muted" aria-hidden>
            /
          </span>
          <ThemeButton active={theme === 'dark'} onClick={() => setTheme('dark')} label="Thème sombre" icon={<Moon className="size-4" />} />
        </div>
        <AiButton />
      </div>
    </header>
  )
}

function ThemeButton({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`grid size-7 place-items-center rounded-md transition-colors ${active ? 'bg-elevated text-accent-ink' : 'text-muted hover:text-fg'}`}
    >
      {icon}
    </button>
  )
}

function ProjectSwitcher({ projects, project }: { projects: Project[]; project: Project | undefined }) {
  const [open, setOpen] = useState(false)
  const { setProject, openDialog } = useAppState((state) => ({ setProject: state.setProject, openDialog: state.openDialog }))
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    // Phase de capture + preventDefault : Échap ferme le menu seul, pas la fiche élément ouverte derrière.
    const onKey = (event: KeyboardEvent) => {
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

  return (
    <div className="relative min-w-0" ref={root}>
      <button
        type="button"
        className="ds-btn max-w-[min(16rem,40vw)] bg-sunken"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="truncate">{project?.name ?? 'Choisir un projet'}</span>
        <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
      </button>
      {open && (
        <div className="ds-card absolute left-0 top-full z-40 mt-2 w-72 overflow-hidden p-1 shadow-overlay">
          <ul role="listbox" aria-label="Projets" className="max-h-80 overflow-y-auto">
            {projects.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={candidate.id === project?.id}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-hover"
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
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-accent-ink hover:bg-hover"
              onClick={() => {
                setOpen(false)
                openDialog({ kind: 'project' })
              }}
            >
              <FolderPlus className="size-4" aria-hidden />
              Nouveau projet
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Rail() {
  const { view, setView, railExpanded, openDialog } = useAppState((state) => ({
    view: state.view,
    setView: state.setView,
    railExpanded: state.railExpanded,
    openDialog: state.openDialog,
  }))
  const item = (active: boolean) =>
    `flex h-10 items-center gap-3 rounded-lg px-2.5 transition-colors ${
      active ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-hover hover:text-fg'
    }`

  return (
    <nav
      aria-label="Navigation principale"
      className={`hidden shrink-0 flex-col gap-1 border-r border-line bg-surface p-2 md:flex ${railExpanded ? 'w-56' : 'w-[60px]'}`}
    >
      {VIEWS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className={item(entry.id === view)}
          aria-current={entry.id === view ? 'page' : undefined}
          title={railExpanded ? undefined : entry.label}
          onClick={() => setView(entry.id)}
        >
          {entry.icon}
          {railExpanded && <span className="truncate">{entry.short}</span>}
        </button>
      ))}
      <button type="button" className={item(false)} title={railExpanded ? undefined : 'Ajouter une phase'} onClick={() => openDialog({ kind: 'phase' })}>
        <Plus className="size-5" aria-hidden />
        {railExpanded ? <span>Nouvelle phase</span> : <span className="sr-only">Ajouter une phase</span>}
      </button>
      <a
        className={`${item(false)} mt-auto`}
        href="/api/docs"
        target="_blank"
        rel="noreferrer"
        title={railExpanded ? undefined : 'Documentation de l’API'}
      >
        <CircleHelp className="size-5" aria-hidden />
        {railExpanded ? <span>Documentation API</span> : <span className="sr-only">Documentation de l’API</span>}
      </a>
    </nav>
  )
}

export function ViewTabs() {
  const { view, setView } = useAppState((state) => ({ view: state.view, setView: state.setView }))
  return (
    <Tabs
      label="Vues du projet"
      value={view}
      onChange={setView}
      tabs={VIEWS.map((entry) => ({ id: entry.id, label: entry.label }))}
      className="overflow-x-auto px-4 sm:px-6"
    />
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
          className="ds-card pointer-events-auto flex items-start gap-3 border-l-4 border-l-kind p-3 shadow-overlay"
        >
          <span className="ds-dot mt-1.5" aria-hidden />
          <p className="flex-1 leading-snug">{toast.message}</p>
          <button type="button" className="text-muted hover:text-fg" aria-label="Fermer la notification" onClick={() => dismiss(toast.id)}>
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
