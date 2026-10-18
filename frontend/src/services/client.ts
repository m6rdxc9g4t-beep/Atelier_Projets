// Client HTTP typé de l'API backend : chemins, paramètres et réponses viennent du contrat OpenAPI
// (api.gen.ts, généré depuis backend/openapi.json). Les erreurs deviennent des ApiError en français.
import createClient from 'openapi-fetch'
import type { paths } from './api.gen.ts'

export const http = createClient<paths>({ baseUrl: '' })

/** Erreur renvoyée par l'API (format unique du backend) ou backend injoignable. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }

  get unreachable(): boolean {
    return this.code === 'BACKEND_UNREACHABLE'
  }
}

const UNREACHABLE = 'Backend injoignable : lancer « npm run dev:backend » (ou « npm run dev ») à la racine du projet.'

interface FetchResult<T> {
  data?: T
  error?: unknown
  response: Response
}

/** Attend une réponse de l'API et renvoie ses données, ou lève une ApiError explicite. */
export async function unwrap<T>(request: Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>
  try {
    result = await request
  } catch (error) {
    // Requête annulée par l'interface (AbortController) : ce n'est pas une panne du backend.
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(UNREACHABLE, 0, 'BACKEND_UNREACHABLE')
  }
  const { data, error, response } = result
  if (response.ok) return data as T
  // Le proxy de Vite répond 502/504 quand le backend est arrêté.
  if ((response.status === 502 || response.status === 504) && !isApiError(error)) {
    throw new ApiError(UNREACHABLE, response.status, 'BACKEND_UNREACHABLE')
  }
  if (isApiError(error)) throw new ApiError(error.message, response.status, error.code)
  throw new ApiError(`Erreur ${response.status} de l’API`, response.status, 'HTTP_ERROR')
}

function isApiError(value: unknown): value is { message: string; code: string } {
  return typeof value === 'object' && value !== null && typeof (value as { message?: unknown }).message === 'string'
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
