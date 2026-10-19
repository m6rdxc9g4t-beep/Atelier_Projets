// Thème clair / sombre (docs/SUITE.md §1.5) : sur <html>, data-theme="dark" ET la classe « dark » en sombre,
// data-theme="light" sans classe « dark » en clair. Préférence : Clair, Sombre ou Système (suit l'OS).
// Le script de index.html applique la même règle avant le premier rendu.

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function systemTheme(): ResolvedTheme {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference
}

/** Pose les deux marqueurs du thème sur <html>. */
export function applyTheme(theme: ResolvedTheme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme
  root.classList.toggle('dark', theme === 'dark')
}

/** Suit les changements du thème du système ; renvoie la fonction de désabonnement. */
export function onSystemThemeChange(listener: (theme: ResolvedTheme) => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined
  const query = matchMedia(DARK_QUERY)
  const handler = () => listener(query.matches ? 'dark' : 'light')
  query.addEventListener('change', handler)
  return () => query.removeEventListener('change', handler)
}
