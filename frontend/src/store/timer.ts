// Chronomètre (un seul à la fois, tenu par le backend). Le temps écoulé affiché part de la valeur renvoyée
// par l'API et avance localement chaque seconde ; l'arrêt crée la saisie de temps côté backend.
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { hours } from '../lib/format.ts'
import { errorMessage } from '../services/client.ts'
import { timerService } from '../services/api.ts'
import type { RunningTimer } from '../services/types.ts'
import { useApp } from './app.ts'

interface TimerStore {
  timer: RunningTimer | null
  /** Instant (horloge du navigateur) où `timer.elapsedSeconds` a été lu. */
  syncedAt: number
  busy: boolean
  load: () => Promise<void>
  start: (workItemId: number) => Promise<void>
  stop: (comment?: string) => Promise<void>
  discard: () => Promise<void>
}

async function guarded(set: (partial: Partial<TimerStore>) => void, action: () => Promise<void>): Promise<void> {
  set({ busy: true })
  try {
    await action()
  } catch (error) {
    useApp.getState().notify('error', errorMessage(error))
    // État incertain (chronomètre arrêté ailleurs, élément supprimé) : on relit.
    await useTimer.getState().load()
  } finally {
    set({ busy: false })
  }
}

export const useTimer = create<TimerStore>()((set) => ({
  timer: null,
  syncedAt: 0,
  busy: false,
  load: async () => {
    try {
      const { timer } = await timerService.get()
      set({ timer, syncedAt: Date.now() })
    } catch {
      /* backend injoignable : l'application l'affiche déjà */
    }
  },
  start: (workItemId) =>
    guarded(set, async () => {
      const { timer, stopped } = await timerService.start(workItemId)
      set({ timer, syncedAt: Date.now() })
      const { notify, refresh } = useApp.getState()
      if (stopped) refresh()
      notify(
        'success',
        stopped
          ? `${hours(stopped.timeEntry.duration.hours)} saisies sur #${stopped.workItemId} ; chronomètre démarré sur #${workItemId}`
          : `Chronomètre démarré sur #${workItemId}`,
      )
    }),
  stop: (comment) =>
    guarded(set, async () => {
      const result = await timerService.stop(comment)
      set({ timer: null, syncedAt: Date.now() })
      const { notify, refresh } = useApp.getState()
      refresh()
      notify(
        'success',
        `${hours(result.timeEntry.duration.hours)} saisies sur #${result.workItemId}${result.capped ? ' (plafonné à 24 h)' : ''}`,
      )
    }),
  discard: () =>
    guarded(set, async () => {
      await timerService.discard()
      set({ timer: null, syncedAt: Date.now() })
      useApp.getState().notify('info', 'Chronomètre abandonné, aucun temps saisi')
    }),
}))

/** Secondes écoulées du chronomètre en cours (rafraîchies chaque seconde), ou null. */
export function useElapsedSeconds(): number | null {
  const timer = useTimer((state) => state.timer)
  const syncedAt = useTimer((state) => state.syncedAt)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!timer) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timer])
  if (!timer) return null
  return timer.elapsedSeconds + Math.max(0, Math.floor((now - syncedAt) / 1000))
}

/** « 1:05:09 » ou « 12:04 ». */
export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
