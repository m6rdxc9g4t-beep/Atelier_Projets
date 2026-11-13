// État partagé des moteurs d'IA (Ollama, Claude) et du mode hors ligne / en ligne : lu une fois, relu à la
// demande (ouverture d'un dialogue IA, « Actualiser », changement de mode). L'en-tête, le panneau IA et les
// dialogues lisent la même valeur : pas de pastille en retard sur le dialogue.
import { create } from 'zustand'
import { createLatestGate } from '../lib/engine.ts'
import { aiService, settingsService } from '../services/api.ts'
import { errorMessage } from '../services/client.ts'
import type { AiStatus } from '../services/types.ts'

interface AiStore {
  status: AiStatus | null
  error: string | null
  loading: boolean
  /** Changement de mode en cours. */
  switching: boolean
  /** Relit l'état (refresh : revérifie aussi la connexion de Claude, sans le cache de 60 s du serveur). */
  load: (refresh?: boolean) => Promise<void>
  /** Mode jeton : redonne sa chance à un jeton refusé (« Revérifier le jeton »), puis relit l'état. */
  retryToken: () => Promise<void>
  /** Active ou coupe le mode en ligne (réglage du backend), puis relit l'état des moteurs. */
  setOnline: (online: boolean) => Promise<void>
}

let pending: Promise<void> | null = null
/** Une réponse plus ancienne (arrivée après) n'écrase pas la plus récente. */
const reads = createLatestGate()

export const useAi = create<AiStore>()((set, get) => {
  /** Relit l'état ; une relecture simple réutilise une lecture en cours. */
  function read(refresh: boolean, retryToken: boolean): Promise<void> {
    if (pending && !refresh) return pending
    set({ loading: true })
    const id = reads.begin()
    const request = aiService
      .status(refresh, retryToken)
      .then(
        (status) => {
          if (reads.isLatest(id)) set({ status, error: null })
        },
        (error: unknown) => {
          if (reads.isLatest(id)) set({ error: errorMessage(error) })
        },
      )
      .finally(() => {
        if (pending === request) pending = null
        if (reads.isLatest(id)) set({ loading: false })
      })
    pending = request
    return request
  }

  return {
    status: null,
    error: null,
    loading: false,
    switching: false,

    load: (refresh = false) => read(refresh, false),
    retryToken: () => read(true, true),

    setOnline: async (online) => {
      set({ switching: true })
      try {
        await settingsService.update({ onlineMode: online })
        await get().load(true)
      } finally {
        set({ switching: false })
      }
    },
  }
})
