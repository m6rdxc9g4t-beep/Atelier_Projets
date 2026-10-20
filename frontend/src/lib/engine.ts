// Choix du moteur d'IA (docs/SUITE.md §5.2) : règles d'affichage tirées de l'état renvoyé par le backend.
// Le backend décide seul du moteur (Auto) et refuse Claude hors ligne ; ces fonctions ne font qu'annoncer
// à l'utilisateur ce qui va se passer.
import type { AiEngine, AiStatus, ClaudeModel, EngineChoice } from '../services/types.ts'

export const ENGINE_CHOICES: readonly { id: EngineChoice; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'ollama', label: 'Ollama' },
  { id: 'claude', label: 'Claude' },
]

export const CLAUDE_MODELS: readonly ClaudeModel[] = ['sonnet', 'opus', 'haiku']
export const CLAUDE_MODEL_LABEL: Record<ClaudeModel, string> = { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku' }
export const ENGINE_LABEL: Record<AiEngine, string> = { ollama: 'Ollama', claude: 'Claude' }

/** Raison pour laquelle « Claude » est grisé (null : choix possible). */
export function claudeBlockedReason(status: AiStatus | null): string | null {
  if (!status) return null
  if (!status.onlineMode) return 'Mode hors ligne : activer « En ligne » dans l’en-tête pour utiliser Claude.'
  if (!status.claude.available) return status.claude.error ?? 'Claude est indisponible.'
  return null
}

/**
 * Choix effectif (comme Atelier Viz et Atelier Tab) : « Claude » retombe sur « Auto » **hors ligne seulement**.
 * En ligne, un Claude explicitement choisi mais indisponible reste « Claude » : la requête part telle quelle et
 * le serveur répond une erreur claire (502 CLAUDE_UNAVAILABLE) au lieu de répondre en silence par Ollama.
 */
export function effectiveChoice(choice: EngineChoice, status: AiStatus | null): EngineChoice {
  return choice === 'claude' && status !== null && !status.onlineMode ? 'auto' : choice
}

/** Moteur qui répondra : Auto = Claude si en ligne et disponible, sinon Ollama ; Claude choisi en ligne = Claude (ou une erreur). */
export function answeringEngine(choice: EngineChoice, status: AiStatus | null): AiEngine {
  const effective = effectiveChoice(choice, status)
  if (effective === 'auto') return status?.auto ?? 'ollama'
  return effective
}

/** Modèle Claude valide (une préférence mémorisée peut avoir été modifiée à la main). */
export function safeClaudeModel(model: unknown): ClaudeModel {
  return CLAUDE_MODELS.find((candidate) => candidate === model) ?? 'sonnet'
}

/** Moteur valide (préférence mémorisée), sinon « Auto ». */
export function safeEngineChoice(choice: unknown): EngineChoice {
  return ENGINE_CHOICES.find((option) => option.id === choice)?.id ?? 'auto'
}

/** Nom de modèle Ollama plausible (« qwen2.5-coder:7b », « hf.co/org/modele:Q4_K_M »), sinon null (modèle du serveur). */
export function safeOllamaModel(model: unknown): string | null {
  if (typeof model !== 'string') return null
  const name = model.trim()
  return name.length > 0 && name.length <= 200 && /^[\w.:/@+-]+$/.test(name) ? name : null
}

export interface AiPreferences {
  aiEngine: EngineChoice
  claudeModel: ClaudeModel
  aiModel: string | null
}

/**
 * Préférences IA relues du stockage local (modifiable à la main, ou par une ancienne version) : chaque valeur
 * est validée, une valeur inconnue reprend sa valeur par défaut (Auto, Sonnet, modèle Ollama du serveur).
 */
export function restoreAiPreferences(saved: unknown): AiPreferences {
  const values = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : {}
  return { aiEngine: safeEngineChoice(values.aiEngine), claudeModel: safeClaudeModel(values.claudeModel), aiModel: safeOllamaModel(values.aiModel) }
}

/** « Claude · Sonnet », « Ollama · qwen2.5-coder:7b ». */
export function engineResultLabel(engine: AiEngine, model: string): string {
  return engine === 'claude' ? `Claude · ${CLAUDE_MODEL_LABEL[safeClaudeModel(model)]}` : `Ollama · ${model}`
}

/** Ollama prêt : joignable et modèle choisi (ou modèle par défaut) installé. */
export function ollamaReady(status: AiStatus | null, aiModel: string | null): boolean {
  const ollama = status?.ollama
  if (!ollama?.reachable) return false
  return aiModel === null ? ollama.defaultModelInstalled : ollama.models.some((model) => model.name === aiModel)
}

/** Nombre lisible : 24000 → « 24 000 ». */
export function formatChars(value: number): string {
  return new Intl.NumberFormat('fr-FR').format(value)
}
