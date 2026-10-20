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
  FileUp,
  Menu,
  Monitor,
  Moon,
  Plus,
  Settings,
  Sun,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { githubLabel } from '../lib/format.ts'
import { useShallow } from 'zustand/react/shallow'
import { CLAUDE_MODEL_LABEL, ollamaReady, safeClaudeModel } from '../lib/engine.ts'
import type { Project } from '../services/types.ts'
import { useAi } from '../store/ai.ts'
import { useApp, useAppState, type Theme, type ViewId } from '../store/app.ts'
import { OnlineSwitch } from './AiDialogs.tsx'
import { AtelierBrand } from './AtelierBrand.tsx'
import { SuiteSwitcher } from './SuiteSwitcher.tsx'
import { TimerPill } from './Timer.tsx'
import { Button, Tabs } from './ui.tsx'

export const VIEWS: { id: ViewId; label: string; short: string; icon: ReactNode }[] = [
  { id: 'dashboard', label: 'Tableau de bord', short: 'Tableau de bord', icon: <LayoutDashboard className="size-5" /> },
  { id: 'gantt', label: 'Gantt & Avancement du projet', short: 'Gantt', icon: <CalendarRange className="size-5" /> },
  { id: 'timesheet', label: 'Tableau des temps', short: 'Temps', icon: <Clock3 className="size-5" /> },
  { id: 'settings', label: 'Paramètres du projet', short: 'Paramètres', icon: <Settings className="size-5" /> },
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
      <div className="hidden items-center gap-1.5 lg:flex" role="group" aria-label="État des moteurs d’IA">
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
      className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-fg hover:bg-hover"
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
    <Button variant="primary" icon={<Bot className="size-4" />} title="Intelligence artificielle : moteurs, modèles, session Claude CLI" className="hidden sm:inline-flex" onClick={() => openDialog({ kind: 'ai' })}>
      IA
    </Button>
  )
}

export function Header({ projects, project }: { projects: Project[]; project: Project | undefined }) {
  const { theme, setTheme, toggleRail } = useAppState((state) => ({ theme: state.theme, setTheme: state.setTheme, toggleRail: state.toggleRail }))
  const github = githubLabel(project?.github)

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 sm:gap-3 border-b border-line bg-surface px-3 sm:px-4">
      <Button variant="ghost" icon={<Menu className="size-5" />} aria-label="Afficher ou masquer les libellés du menu" onClick={toggleRail} />
      <SuiteSwitcher />
      <div className="pr-1">
        <AtelierBrand nameClassName="hidden sm:inline" />
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
        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-sunken p-0.5" role="group" aria-label="Thème">
          {THEMES.map((option) => (
            <ThemeButton
              key={option.id}
              active={theme === option.id}
              onClick={() => setTheme(option.id)}
              label={option.label}
              icon={option.icon}
            />
          ))}
        </div>
        <AiControls />
      </div>
    </header>
  )
}

const THEMES: { id: Theme; label: string; icon: ReactNode }[] = [
  { id: 'light', label: 'Thème clair', icon: <Sun className="size-4" /> },
  { id: 'dark', label: 'Thème sombre', icon: <Moon className="size-4" /> },
  { id: 'system', label: 'Thème du système', icon: <Monitor className="size-4" /> },
]

function ThemeButton({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
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
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-accent-ink hover:bg-hover"
              onClick={() => {
                setOpen(false)
                openDialog({ kind: 'importTab' })
              }}
            >
              <FileUp className="size-4" aria-hidden />
              Importer depuis Atelier Tab…
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
