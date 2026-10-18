// Chronomètre : pastille dans l'en-tête (temps écoulé, arrêt avec commentaire) et bouton de la fiche élément.
import { Pause, Play, Timer as TimerIcon, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useApp } from '../store/app.ts'
import { formatElapsed, useElapsedSeconds, useTimer } from '../store/timer.ts'
import { Button } from './ui.tsx'

/** Pastille de l'en-tête, visible seulement quand un chronomètre tourne. */
export function TimerPill() {
  const timer = useTimer((state) => state.timer)
  const busy = useTimer((state) => state.busy)
  const elapsed = useElapsedSeconds()
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState('')
  const root = useRef<HTMLDivElement>(null)

  // Lu au démarrage puis au retour sur l'onglet (chronomètre démarré ou arrêté dans un autre onglet).
  useEffect(() => {
    const { load } = useTimer.getState()
    void load()
    const onVisible = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
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

  useEffect(() => {
    if (!timer) setOpen(false)
  }, [timer])

  if (!timer || elapsed === null) return null

  const stop = async (event: FormEvent) => {
    event.preventDefault()
    await useTimer.getState().stop(comment.trim() || undefined)
    setComment('')
  }

  const openItem = () => {
    const { projectId, setProject, openWorkItem } = useApp.getState()
    if (projectId !== timer.projectId) setProject(timer.projectId)
    openWorkItem(timer.workItemId)
    setOpen(false)
  }

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        className="ds-btn gap-2 tabular-nums"
        data-status="IN_PROGRESS"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Chronomètre en cours sur #${timer.workItemId} : ${timer.title}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="ds-dot animate-pulse" aria-hidden />
        <span className="font-semibold">{formatElapsed(elapsed)}</span>
        <span className="hidden text-muted md:inline">#{timer.workItemId}</span>
      </button>
      {open && (
        <form
          onSubmit={stop}
          role="dialog"
          aria-label="Chronomètre"
          className="ds-card absolute right-0 top-full z-40 mt-2 w-80 space-y-3 p-4 shadow-overlay"
        >
          <div className="flex items-start gap-2">
            <TimerIcon className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden />
            <div className="min-w-0">
              <button type="button" className="block max-w-full truncate text-left font-semibold hover:underline" onClick={openItem}>
                <span className="ds-ink" data-type={timer.type}>
                  #{timer.workItemId}
                </span>{' '}
                {timer.title}
              </button>
              <p className="text-xs text-muted">
                Depuis {new Date(timer.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                <span className="tabular-nums">{formatElapsed(elapsed)}</span>
              </p>
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Commentaire de la saisie (facultatif)</span>
            <input className="ds-input" value={comment} maxLength={2000} placeholder="Chronomètre" onChange={(event) => setComment(event.target.value)} autoFocus />
          </label>
          <div className="flex justify-between gap-2">
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} busy={busy} onClick={() => void useTimer.getState().discard()}>
              Abandonner
            </Button>
            <Button size="sm" type="submit" variant="primary" icon={<Pause className="size-4" />} busy={busy}>
              Arrêter et saisir
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

/** Bouton de la fiche : démarre le chronomètre sur cet élément, ou l'arrête s'il y tourne. */
export function TimerButton({ workItemId }: { workItemId: number }) {
  const running = useTimer((state) => state.timer?.workItemId === workItemId)
  const busy = useTimer((state) => state.busy)
  const elapsed = useElapsedSeconds()
  if (running && elapsed !== null) {
    return (
      <Button size="sm" icon={<Pause className="size-4" />} busy={busy} onClick={() => void useTimer.getState().stop()} title="Arrêter et saisir le temps écoulé">
        <span className="tabular-nums">{formatElapsed(elapsed)}</span>
      </Button>
    )
  }
  return (
    <Button size="sm" icon={<Play className="size-4" />} busy={busy} onClick={() => void useTimer.getState().start(workItemId)} title="Démarrer le chronomètre sur cet élément">
      Chrono
    </Button>
  )
}
