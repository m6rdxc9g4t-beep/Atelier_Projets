// État d'interface (Zustand) : thème, projet et vue courants, élément ouvert, dialogues, notifications.
// Les données métier ne sont pas copiées ici : chaque vue les lit dans l'API ; « revision » les fait relire
// après une modification.
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { restoreAiPreferences } from '../lib/engine.ts'
import type { ThemePreference } from '../lib/theme.ts'
import type { ClaudeModel, EngineChoice, WorkItemType } from '../services/types.ts'

/** Préférence de thème : Clair, Sombre ou Système (voir lib/theme.ts). */
export type Theme = ThemePreference
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
  | { kind: 'ai' }
  | { kind: 'breakdown'; storyId: number; label: string }
  | { kind: 'claude'; workItemId: number }
  | { kind: 'linkRepo'; workItemId: number | null }
  | { kind: 'importTab' }

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
  /** Modèle Ollama choisi dans le panneau IA (null = modèle par défaut du serveur, OLLAMA_MODEL). */
  aiModel: string | null
  /** Moteur choisi : Auto, Ollama ou Claude (docs/SUITE.md §5.2), mémorisé. */
  aiEngine: EngineChoice
  /** Modèle Claude choisi (Sonnet par défaut), mémorisé. */
  claudeModel: ClaudeModel
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
  setAiModel: (model: string | null) => void
  setAiEngine: (engine: EngineChoice) => void
  setClaudeModel: (model: ClaudeModel) => void
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

/** Avant la relecture du stockage : la préférence appliquée par index.html (Système par défaut). */
function initialTheme(): Theme {
  const preference = document.documentElement.dataset.themePreference
  return preference === 'light' || preference === 'dark' ? preference : 'system'
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
      aiModel: null,
      aiEngine: 'auto',
      claudeModel: 'sonnet',
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
      setAiModel: (aiModel) => set({ aiModel }),
      setAiEngine: (aiEngine) => set({ aiEngine }),
      setClaudeModel: (claudeModel) => set({ claudeModel }),
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
      // Le stockage local peut contenir n'importe quoi (modifié à la main, ancienne version) : préférences IA validées.
      merge: (persisted, current) => {
        const saved = typeof persisted === 'object' && persisted !== null ? (persisted as Partial<AppState>) : {}
        return { ...current, ...saved, ...restoreAiPreferences(saved) }
      },
      partialize: (state) => ({
        theme: state.theme,
        projectId: state.projectId,
        view: state.view,
        railExpanded: state.railExpanded,
        aiModel: state.aiModel,
        aiEngine: state.aiEngine,
        claudeModel: state.claudeModel,
      }),
    },
  ),
)

/** Sélection de plusieurs champs du store (comparaison superficielle : pas de rendu superflu). */
export function useAppState<T>(selector: (state: AppState) => T): T {
  return useApp(useShallow(selector))
}
