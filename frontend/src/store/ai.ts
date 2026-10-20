// État partagé des moteurs d'IA (Ollama, Claude) et du mode hors ligne / en ligne : lu une fois, relu à la
// demande (ouverture d'un dialogue IA, « Actualiser », changement de mode). L'en-tête, le panneau IA et les
// dialogues lisent la même valeur : pas de pastille en retard sur le dialogue.
import { create } from 'zustand'
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
  /** Active ou coupe le mode en ligne (réglage du backend), puis relit l'état des moteurs. */
  setOnline: (online: boolean) => Promise<void>
}

let pending: Promise<void> | null = null

export const useAi = create<AiStore>()((set, get) => ({
  status: null,
  error: null,
  loading: false,
  switching: false,

  load: (refresh = false) => {
    if (pending && !refresh) return pending
    set({ loading: true })
    const request = aiService
      .status(refresh)
      .then(
        (status) => set({ status, error: null }),
        (error: unknown) => set({ error: errorMessage(error) }),
      )
      .finally(() => {
        if (pending === request) pending = null
        set({ loading: false })
      })
    pending = request
    return request
  },

  setOnline: async (online) => {
    set({ switching: true })
    try {
      await settingsService.update({ onlineMode: online })
      await get().load(true)
    } finally {
      set({ switching: false })
    }
  },
}))
