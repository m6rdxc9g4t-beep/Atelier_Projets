// Pont vers l'IA locale Ollama (http://localhost:11434 par défaut) derrière une interface minimale,
// remplaçable dans les tests. Modèles conseillés : qwen2.5-coder, gemma3 (configurables).

export interface OllamaModel {
  name: string
  /** Taille du modèle sur le disque, en octets. */
  size: number
  parameterSize: string | null
  family: string | null
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  /** Schéma JSON imposé à la réponse (sorties structurées d'Ollama), ou absent pour du texte libre. */
  format?: Record<string, unknown>
  temperature?: number
  /** Annulation par l'appelant (requête HTTP abandonnée par le navigateur). */
  signal?: AbortSignal
}

export interface OllamaClient {
  readonly baseUrl: string
  /** Modèles installés (GET /api/tags). */
  listModels(): Promise<OllamaModel[]>
  /** Réponse complète du modèle (POST /api/chat, lue en flux puis assemblée). */
  chat(request: ChatRequest): Promise<string>
}

/**
 * Échec d'un appel à Ollama. kind :
 * - unreachable : Ollama ne répond pas (application fermée, autre port) ;
 * - model : modèle absent (à installer avec `ollama pull`) ;
 * - timeout : génération trop longue ;
 * - cancelled : génération abandonnée par l'appelant ;
 * - failed : autre erreur renvoyée par Ollama.
 */
export class OllamaError extends Error {
  readonly kind: 'unreachable' | 'model' | 'timeout' | 'cancelled' | 'failed'

  constructor(kind: OllamaError['kind'], message: string) {
    super(message)
    this.name = 'OllamaError'
    this.kind = kind
  }
}

interface TagsResponse {
  models?: { name?: string; model?: string; size?: number; details?: { parameter_size?: string; family?: string } }[]
}

interface ChatResponse {
  message?: { content?: string }
  error?: string
}

/**
 * contextTokens : fenêtre de contexte demandée à Ollama (num_ctx). Sans elle, Ollama tronque silencieusement
 * les longs prompts (diffs) à sa valeur par défaut.
 */
export function createOllamaClient(options: { baseUrl: string; timeoutMs: number; contextTokens?: number }): OllamaClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const contextTokens = options.contextTokens ?? 16_384

  async function send(path: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs)
    try {
      const response = await fetch(`${baseUrl}${path}`, { ...init, signal: signal ? AbortSignal.any([timeout, signal]) : timeout })
      if (!response.ok) throw await failure(response)
      return response
    } catch (error) {
      throw translate(error, timeout, timeoutMs, signal)
    }
  }

  function translate(error: unknown, timeout: AbortSignal, timeoutMs: number, signal?: AbortSignal): OllamaError {
    if (error instanceof OllamaError) return error
    if (signal?.aborted) return new OllamaError('cancelled', 'Génération annulée')
    if (timeout.aborted) return new OllamaError('timeout', `Ollama n’a pas répondu en ${Math.round(timeoutMs / 1000)} s (OLLAMA_TIMEOUT_MS)`)
    return new OllamaError('unreachable', `Ollama est injoignable sur ${baseUrl} : lancer l’application Ollama (ou « ollama serve »)`)
  }

  async function failure(response: Response): Promise<OllamaError> {
    const text = await response.text().catch(() => '')
    let detail: unknown
    try {
      detail = (JSON.parse(text) as { error?: unknown }).error
    } catch {
      detail = undefined
    }
    const message = typeof detail === 'string' ? detail : `HTTP ${response.status}`
    if (response.status === 404 && /model/i.test(message)) {
      return new OllamaError('model', `Modèle absent d’Ollama (${message}) : l’installer avec « ollama pull <modèle> »`)
    }
    return new OllamaError('failed', `Erreur d’Ollama : ${message}`)
  }

  return {
    baseUrl,
    async listModels() {
      const timeoutMs = Math.min(options.timeoutMs, 5000)
      const timeout = AbortSignal.timeout(timeoutMs)
      let body: TagsResponse | null
      try {
        body = (await (await send('/api/tags', { method: 'GET' }, timeoutMs)).json()) as TagsResponse | null
      } catch (error) {
        throw translate(error, timeout, timeoutMs)
      }
      return (body?.models ?? [])
        .map((model) => ({
          name: model.name ?? model.model ?? '',
          size: typeof model.size === 'number' ? model.size : 0,
          parameterSize: model.details?.parameter_size ?? null,
          family: model.details?.family ?? null,
        }))
        .filter((model) => model.name !== '')
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    async chat({ model, messages, format, temperature = 0.2, signal }) {
      // Flux NDJSON : les en-têtes arrivent tout de suite (pas de délai d'attente des en-têtes de fetch,
      // 300 s), le texte est assemblé au fil des morceaux.
      const timeout = AbortSignal.timeout(options.timeoutMs)
      const combined = signal ? AbortSignal.any([timeout, signal]) : timeout
      let content = ''
      try {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, messages, stream: true, ...(format && { format }), options: { temperature, num_ctx: contextTokens } }),
          signal: combined,
        })
        if (!response.ok) throw await failure(response)
        if (!response.body) throw new OllamaError('failed', 'Réponse d’Ollama vide')
        const decoder = new TextDecoder()
        let buffer = ''
        const consume = (line: string) => {
          if (line.trim() === '') return
          let chunk: ChatResponse & { done?: boolean }
          try {
            chunk = JSON.parse(line) as ChatResponse & { done?: boolean }
          } catch {
            throw new OllamaError('failed', 'Réponse d’Ollama illisible')
          }
          if (typeof chunk.error === 'string') throw new OllamaError('failed', `Erreur d’Ollama : ${chunk.error}`)
          content += chunk.message?.content ?? ''
        }
        for await (const part of response.body) {
          buffer += decoder.decode(part, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) consume(line)
        }
        consume(buffer + decoder.decode())
      } catch (error) {
        throw translate(error, timeout, options.timeoutMs, signal)
      }
      return content
    },
  }
}

/**
 * Modèle installé correspondant au nom demandé : nom exact, sinon « nom:latest », sinon l'unique étiquette
 * installée de ce modèle (« qwen2.5-coder » → « qwen2.5-coder:7b » si c'est la seule).
 */
export function findInstalledModel(models: readonly OllamaModel[], wanted: string): OllamaModel | undefined {
  const exact = models.find((model) => model.name === wanted || model.name === `${wanted}:latest`)
  if (exact || wanted.includes(':')) return exact
  const tagged = models.filter((model) => model.name.startsWith(`${wanted}:`))
  return tagged.length === 1 ? tagged[0] : undefined
}
