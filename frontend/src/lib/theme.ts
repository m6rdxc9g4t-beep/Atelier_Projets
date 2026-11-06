// Thème clair / sombre (docs/SUITE.md §1.5) : sur <html>, data-theme="dark" ET la classe « dark » en sombre,
// data-theme="light" sans classe « dark » en clair. Préférence : Système (défaut), Clair ou Sombre.
//
// La préférence est commune à la suite : design-system/brand/atelier-theme.js, injecté tel quel dans le <head>
// de index.html par vite.config.ts (avant l'affichage), la lit, l'applique et l'enregistre (cookie atelier_theme
// sur le VPS, localStorage « atelier:theme » ailleurs) ; ce module n'en est que l'accès typé pour React.

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

interface AtelierThemeApi {
  get: () => ThemePreference
  set: (preference: ThemePreference) => void
  resolved: () => ResolvedTheme
}

declare global {
  interface Window {
    atelierTheme?: AtelierThemeApi
  }
}

/** Événement émis par atelier-theme.js à chaque changement (detail = préférence). */
const THEME_EVENT = 'atelier-theme'

function isPreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

/** Préférence courante (Système si le script commun n'est pas chargé). */
export function getThemePreference(): ThemePreference {
  const preference = typeof window === 'undefined' ? undefined : window.atelierTheme?.get()
  return isPreference(preference) ? preference : 'system'
}

/** Enregistre la préférence pour toute la suite et l'applique. */
export function setThemePreference(preference: ThemePreference): void {
  window.atelierTheme?.set(preference)
}

/**
 * Suit les changements de préférence : choix fait dans l'app (événement « atelier-theme ») ou dans une autre app
 * de la suite (relu au retour sur la fenêtre). Renvoie la fonction de désabonnement.
 */
export function onThemePreferenceChange(listener: (preference: ThemePreference) => void): () => void {
  const onChange = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail
    if (isPreference(detail)) listener(detail)
  }
  const onVisible = () => {
    if (!document.hidden) listener(getThemePreference())
  }
  window.addEventListener(THEME_EVENT, onChange)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    window.removeEventListener(THEME_EVENT, onChange)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

/** Pose les deux marqueurs d'un thème sur <html> sans changer la préférence (impression du Gantt). */
export function applyTheme(theme: ResolvedTheme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}
