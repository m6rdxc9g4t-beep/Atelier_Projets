// CORS des routes ouvertes aux autres applications de la Suite Atelier (docs/SUITE.md §4.1).
// Seules les routes marquées `config: { suiteCors: true }` répondent aux navigateurs d'une autre origine :
// http://127.0.0.1:<port> et http://localhost:<port>. L'origine « null » est refusée : n'importe quelle page
// peut l'envoyer (iframe sandbox, URL data:, fichier local) ; l'app de bureau Atelier Tab relaie ses envois
// depuis son processus principal, sans en-tête Origin (requête locale ordinaire).
// Le reste de l'API garde la même origine que son interface (aucun en-tête CORS).
import type { FastifyReply, FastifyRequest } from 'fastify'

export const SUITE_CORS_METHODS = 'POST, OPTIONS'
export const SUITE_CORS_HEADERS = 'Content-Type, Authorization, Idempotency-Key, X-Atelier-Schema-Version'
const EXPOSED_HEADERS = 'Idempotency-Replayed'

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Route ouverte aux applications de la Suite Atelier (CORS restreint aux origines locales en http). */
    suiteCors?: boolean
  }
}

/** Origine acceptée par les routes de la suite : 127.0.0.1 ou localhost en http, sur n'importe quel port (jamais « null »). */
export function isSuiteOrigin(origin: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.pathname === '/' && origin === url.origin
}

/**
 * Requête de l'interface d'Atelier Projets elle-même : l'en-tête Origin désigne exactement l'hôte servi
 * (en-tête Host, port compris — le relais /api de Vite garde le Host d'origine, changeOrigin: false).
 * Un navigateur ne peut pas forger Origin ni Host : une page d'une autre origine (même locale, autre port)
 * ou un appel sans Origin (webhook, relais de l'app de bureau Tab, curl) n'est pas « même origine ».
 */
export function isSameOriginRequest(request: FastifyRequest): boolean {
  const { origin, host } = request.headers
  // Host strictement « nom[:port] » ou « [ipv6][:port] » (pas de « @ », de chemin…) avant de le lire comme une URL.
  if (origin === undefined || !host || !/^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(host)) return false
  try {
    const from = new URL(origin)
    if ((from.protocol !== 'http:' && from.protocol !== 'https:') || origin !== from.origin) return false
    // Host normalisé comme une URL du même schéma (port par défaut retiré, minuscules).
    return new URL(`${from.protocol}//${host}`).host === from.host
  } catch {
    return false
  }
}

/** La requête vise-t-elle une route de la suite ? (la route est résolue avant les hooks onRequest) */
export function isSuiteRoute(request: FastifyRequest): boolean {
  return request.routeOptions.config?.suiteCors === true
}

/** Hook onRequest : en-têtes CORS posés avant tout contrôle, pour qu'une erreur (401, 422…) reste lisible. */
export async function suiteCorsHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isSuiteRoute(request)) return
  reply.header('vary', 'Origin')
  const origin = request.headers.origin
  if (origin === undefined || !isSuiteOrigin(origin)) return
  reply.header('access-control-allow-origin', origin)
  reply.header('access-control-expose-headers', EXPOSED_HEADERS)
  if (request.method === 'OPTIONS') {
    reply.header('access-control-allow-methods', SUITE_CORS_METHODS)
    reply.header('access-control-allow-headers', SUITE_CORS_HEADERS)
    reply.header('access-control-max-age', '600')
  }
}
