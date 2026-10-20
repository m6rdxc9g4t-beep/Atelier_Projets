// Suite Atelier (docs/SUITE.md §2 et §3) : adresses des applications du sélecteur et état « en marche / arrêtée »
// des trois apps locales. Adresses = colonne « Interface (aperçu / app) » du contrat, surchargeables par variables
// Vite : VITE_ATELIER_VIZ_URL, VITE_ATELIER_TAB_URL, VITE_ATELIER_PROJETS_URL, VITE_ATELIER_CUISINE_URL
// (Atelier Cuisine : app en ligne, jamais sondée).

export type SuiteAppId = 'viz' | 'tab' | 'projets' | 'cuisine'

export interface SuiteApp {
  id: SuiteAppId
  /** Nom accessible (« Atelier Viz »…). */
  name: string
  /** Nom court affiché dans la marque : « atelier_ » + short (docs/SUITE.md §1.6). */
  short: string
  description: string
  /** Adresse ouverte par le sélecteur. */
  url: string
  /** Routes de santé essayées : l'application est « en marche » si l'une répond (vide : pas d'indicateur). */
  healthUrls: readonly string[]
  /** App en ligne, sans API locale (Atelier Cuisine) : mention « En ligne » à la place de l'indicateur. */
  online?: boolean
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
const CUISINE_URL = urlFrom('VITE_ATELIER_CUISINE_URL', 'https://atelier-cuisine-iota.vercel.app')
/** Santé d'Atelier Tab lancé par « npm run dev » (docs/SUITE.md §3). */
const TAB_DEV_HEALTH_URL = 'http://127.0.0.1:5175/api/health'

export const SUITE_APPS: readonly SuiteApp[] = [
  {
    id: 'viz',
    name: 'Atelier Viz',
    short: 'Viz',
    description: 'BI locale : rapports, visuels, IA',
    url: VIZ_URL,
    // L'API de Viz est servie par la même adresse que son interface (FastAPI) : /api/health.
    healthUrls: [`${VIZ_URL}/api/health`],
  },
  {
    id: 'tab',
    name: 'Atelier Tab',
    short: 'Tab',
    description: 'Tableur et base de données typée',
    url: TAB_URL,
    // Tab n'a pas d'API de données, seulement une route de santé : app de bureau ou aperçu (4175), puis dev (5175).
    healthUrls: [...new Set([`${TAB_URL}/api/health`, TAB_DEV_HEALTH_URL])],
  },
  {
    id: 'projets',
    name: 'Atelier Projets',
    short: 'Projets',
    description: 'Projets agiles, Git, temps passé',
    url: PROJETS_URL,
    // Application courante : jamais sondée par le sélecteur, toujours « en marche » (docs/SUITE.md §3).
    // Adresse gardée pour une vérification sur sa propre origine (même origine, proxy /api).
    healthUrls: ['/api/health'],
  },
  {
    id: 'cuisine',
    name: 'Atelier Cuisine',
    short: 'Cuisine',
    description: 'Stock, repas, courses et budget du foyer',
    url: CUISINE_URL,
    // App en ligne (PWA + app Mac, données Supabase) : aucune API locale, jamais sondée (docs/SUITE.md §3).
    healthUrls: [],
    online: true,
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

/**
 * Application « en marche » si l'une de ses routes de santé répond (sondées en parallèle, 1,5 s chacune) :
 * Atelier Tab répond sur 4175 (app de bureau, aperçu) ou sur 5175 (dev).
 */
export async function checkAnyHealth(healthUrls: readonly string[], timeoutMs = HEALTH_TIMEOUT_MS): Promise<SuiteStatus> {
  if (healthUrls.length === 0) return 'down'
  const checks = healthUrls.map((url) => checkHealth(url, timeoutMs).then((status) => (status === 'up' ? Promise.resolve('up' as const) : Promise.reject(new Error('down')))))
  return Promise.any(checks).catch(() => 'down' as const)
}
