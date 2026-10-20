// Suite Atelier (docs/SUITE.md §2 et §3) : adresses des trois applications et état « en marche / arrêtée ».
// Adresses = colonne « Interface (aperçu / app) » du contrat, surchargeables par variables Vite :
// VITE_ATELIER_VIZ_URL, VITE_ATELIER_TAB_URL, VITE_ATELIER_PROJETS_URL.

export type SuiteAppId = 'viz' | 'tab' | 'projets'

export interface SuiteApp {
  id: SuiteAppId
  /** Nom accessible (« Atelier Viz »…). */
  name: string
  /** Nom court affiché dans la marque : « atelier_ » + short (docs/SUITE.md §1.6). */
  short: string
  description: string
  /** Adresse ouverte par le sélecteur. */
  url: string
  /** Route de santé de l'API (null : application sans API, pas d'indicateur). */
  healthUrl: string | null
}

/** Application courante. */
export const CURRENT_APP: SuiteAppId = 'projets'

/** Délai d'attente de la route de santé (contrat : 1,5 s). */
export const HEALTH_TIMEOUT_MS = 1500

const env = import.meta.env as Record<string, string | undefined>

function urlFrom(variable: string, fallback: string): string {
  const value = env[variable]?.trim()
  return (value || fallback).replace(/\/+$/, '')
}

const VIZ_URL = urlFrom('VITE_ATELIER_VIZ_URL', 'http://127.0.0.1:8000')
const TAB_URL = urlFrom('VITE_ATELIER_TAB_URL', 'http://127.0.0.1:4175')
const PROJETS_URL = urlFrom('VITE_ATELIER_PROJETS_URL', 'http://127.0.0.1:4174')

export const SUITE_APPS: readonly SuiteApp[] = [
  {
    id: 'viz',
    name: 'Atelier Viz',
    short: 'Viz',
    description: 'BI locale : rapports, visuels, IA',
    url: VIZ_URL,
    // L'API de Viz est servie par la même adresse que son interface (FastAPI) : /api/health.
    healthUrl: `${VIZ_URL}/api/health`,
  },
  {
    id: 'tab',
    name: 'Atelier Tab',
    short: 'Tab',
    description: 'Tableur et base de données typée',
    url: TAB_URL,
    healthUrl: null,
  },
  {
    id: 'projets',
    name: 'Atelier Projets',
    short: 'Projets',
    description: 'Projets agiles, Git, temps passé',
    url: PROJETS_URL,
    // Application courante : son API est jointe par l'interface elle-même (même origine, proxy /api).
    healthUrl: '/api/health',
  },
]

export type SuiteStatus = 'up' | 'down'

/**
 * Teste une route de santé sans bloquer : délai de 1,5 s, jamais d'exception.
 *
 * Une autre application (Viz) est sur une autre origine et n'autorise pas forcément CORS : avec un `fetch`
 * classique, le navigateur bloquerait la réponse et l'app paraîtrait arrêtée. On utilise donc
 * `mode: 'no-cors'` : la réponse est opaque (statut illisible) mais sa simple arrivée prouve que le serveur
 * écoute (« en marche ») ; une erreur réseau ou le délai dépassé signifient « arrêtée ». Limite assumée :
 * une API qui répond 500 apparaît « en marche ». Pour la même origine, le statut HTTP est lu normalement.
 */
export async function checkHealth(healthUrl: string, timeoutMs = HEALTH_TIMEOUT_MS): Promise<SuiteStatus> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const sameOrigin = new URL(healthUrl, window.location.href).origin === window.location.origin
    const response = await fetch(healthUrl, {
      mode: sameOrigin ? 'same-origin' : 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    })
    return response.type === 'opaque' || response.ok ? 'up' : 'down'
  } catch {
    return 'down'
  } finally {
    clearTimeout(timer)
  }
}
