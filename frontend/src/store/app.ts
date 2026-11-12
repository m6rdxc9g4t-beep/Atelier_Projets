// État d'interface (Zustand) : thème, projet et vue courants, élément ouvert, dialogues, notifications.
// Les données métier ne sont pas copiées ici : chaque vue les lit dans l'API ; « revision » les fait relire
// après une modification.
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { restoreAiPreferences } from '../lib/engine.ts'
import { getThemePreference, setThemePreference, type ThemePreference } from '../lib/theme.ts'
import type { ClaudeModel, EngineChoice, WorkItemType } from '../services/types.ts'

/** Préférence de thème : Système, Clair ou Sombre, commune à la suite (voir lib/theme.ts). */
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
  | { kind: 'examples' }
  | { kind: 'deleteProject'; projectId: number }
  | { kind: 'deletePhase'; projectId: number; phaseId: number }

export interface Toast {
  id: number
  tone: 'success' | 'error' | 'info'
  message: string
}

interface AppState {
  theme: Theme
  projectId: number | null
  view: ViewId
  /** Barre latérale dépliée (libellés visibles, 232 px) ; repliée : icônes seules. */
  railExpanded: boolean
  /** Projets dépliés dans l'arborescence de la barre latérale (leurs phases sont visibles). */
  expandedProjectIds: number[]
  /** Phase à montrer dans le Gantt (clic dans la barre latérale), consommée par la vue. */
  focusPhaseId: number | null
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

  /** Enregistre la préférence pour toute la suite (atelier-theme.js) et l'applique. */
  setTheme: (theme: Theme) => void
  /** Reflète une préférence changée ailleurs (autre app de la suite, autre onglet). */
  syncTheme: (theme: Theme) => void
  setProject: (projectId: number | null) => void
  setView: (view: ViewId) => void
  toggleRail: () => void
  /** Déplie ou replie un projet de la barre latérale (force : état voulu). */
  toggleProjectTree: (projectId: number, force?: boolean) => void
  /** Ouvre le Gantt d'un projet sur une phase. */
  showPhase: (projectId: number, phaseId: number) => void
  clearFocusPhase: () => void
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

let toastSequence = 0

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      theme: getThemePreference(),
      projectId: null,
      view: 'gantt',
      railExpanded: true,
      expandedProjectIds: [],
      focusPhaseId: null,
      hoursPerDay: null,
      selectedWorkItemId: null,
      aiModel: null,
      aiEngine: 'auto',
      claudeModel: 'sonnet',
      dialog: null,
      revision: 0,
      toasts: [],

      setTheme: (theme) => {
        setThemePreference(theme)
        set({ theme })
      },
      syncTheme: (theme) => set({ theme }),
      setProject: (projectId) => set({ projectId, selectedWorkItemId: null, hoursPerDay: null }),
      setView: (view) => set({ view }),
      toggleRail: () => set((state) => ({ railExpanded: !state.railExpanded })),
      toggleProjectTree: (projectId, force) =>
        set((state) => {
          const open = state.expandedProjectIds.includes(projectId)
          const want = force ?? !open
          if (want === open) return {}
          return { expandedProjectIds: want ? [...state.expandedProjectIds, projectId] : state.expandedProjectIds.filter((id) => id !== projectId) }
        }),
      showPhase: (projectId, phaseId) =>
        set((state) =>
          state.projectId === projectId
            ? { view: 'gantt', focusPhaseId: phaseId }
            : { projectId, selectedWorkItemId: null, hoursPerDay: null, view: 'gantt', focusPhaseId: phaseId },
        ),
      clearFocusPhase: () => set({ focusPhaseId: null }),
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
        // Le thème n'est plus enregistré ici : la préférence commune de la suite fait foi (l'ancienne valeur est
        // reprise une fois par index.html dans « atelier:theme »).
        const { theme: _legacyTheme, ...rest } = saved
        const expandedProjectIds = Array.isArray(saved.expandedProjectIds)
          ? saved.expandedProjectIds.filter((id): id is number => Number.isInteger(id))
          : []
        return { ...current, ...rest, expandedProjectIds, ...restoreAiPreferences(saved) }
      },
      partialize: (state) => ({
        projectId: state.projectId,
        view: state.view,
        railExpanded: state.railExpanded,
        expandedProjectIds: state.expandedProjectIds,
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
