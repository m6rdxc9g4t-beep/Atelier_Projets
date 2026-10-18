// État d'interface (Zustand) : thème, projet et vue courants, élément ouvert, dialogues, notifications.
// Les données métier ne sont pas copiées ici : chaque vue les lit dans l'API ; « revision » les fait relire
// après une modification.
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import type { WorkItemType } from '../services/types.ts'

export type Theme = 'light' | 'dark'
export type ViewId = 'dashboard' | 'gantt' | 'timesheet' | 'settings'

/** Ce qu'un dialogue de création ou de modification doit produire. */
export type DialogRequest =
  | { kind: 'project' }
  | { kind: 'phase' }
  | { kind: 'epic'; phaseId: number }
  | { kind: 'story'; epicId: number }
  | { kind: 'workItem'; storyId: number; type?: WorkItemType }
  | { kind: 'milestone'; phaseId?: number | null }
  | { kind: 'editContainer'; level: 'phase' | 'epic' | 'story'; id: number; title: string; startDate: string | null; dueDate: string | null }
  | { kind: 'editMilestone'; id: number }

export interface Toast {
  id: number
  tone: 'success' | 'error' | 'info'
  message: string
}

interface AppState {
  theme: Theme
  projectId: number | null
  view: ViewId
  /** Rail de navigation déplié (libellés visibles). */
  railExpanded: boolean
  /** Surcharge de « 1 jour = X heures » pour l'affichage (null = paramètre du projet). */
  hoursPerDay: number | null
  selectedWorkItemId: number | null
  dialog: DialogRequest | null
  revision: number
  toasts: Toast[]

  setTheme: (theme: Theme) => void
  setProject: (projectId: number | null) => void
  setView: (view: ViewId) => void
  toggleRail: () => void
  setHoursPerDay: (hoursPerDay: number | null) => void
  openWorkItem: (workItemId: number | null) => void
  openDialog: (dialog: DialogRequest | null) => void
  /** À appeler après toute écriture : les vues relisent l'API. */
  refresh: () => void
  notify: (tone: Toast['tone'], message: string) => void
  dismiss: (id: number) => void
}

/** localStorage peut être indisponible (navigation privée, stockage bloqué) : l'application fonctionne sans. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
    } catch {
      /* préférence non mémorisée */
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch {
      /* rien à faire */
    }
  },
}

function initialTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

let toastSequence = 0

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      theme: initialTheme(),
      projectId: null,
      view: 'gantt',
      railExpanded: false,
      hoursPerDay: null,
      selectedWorkItemId: null,
      dialog: null,
      revision: 0,
      toasts: [],

      setTheme: (theme) => set({ theme }),
      setProject: (projectId) => set({ projectId, selectedWorkItemId: null, hoursPerDay: null }),
      setView: (view) => set({ view }),
      toggleRail: () => set((state) => ({ railExpanded: !state.railExpanded })),
      setHoursPerDay: (hoursPerDay) => set({ hoursPerDay }),
      openWorkItem: (selectedWorkItemId) => set({ selectedWorkItemId }),
      openDialog: (dialog) => set({ dialog }),
      refresh: () => set((state) => ({ revision: state.revision + 1 })),
      notify: (tone, message) => {
        const id = ++toastSequence
        set((state) => ({ toasts: [...state.toasts.slice(-3), { id, tone, message }] }))
        setTimeout(() => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })), tone === 'error' ? 7000 : 3500)
      },
      dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
    }),
    {
      name: 'atelier-projets:ui',
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ theme: state.theme, projectId: state.projectId, view: state.view, railExpanded: state.railExpanded }),
    },
  ),
)

/** Sélection de plusieurs champs du store (comparaison superficielle : pas de rendu superflu). */
export function useAppState<T>(selector: (state: AppState) => T): T {
  return useApp(useShallow(selector))
}
