// « Moteur : Auto · Ollama · Claude » (docs/SUITE.md §5.2), même disposition et mêmes libellés qu'Atelier Viz :
// commande segmentée, modèle (Ollama ou Claude), ligne bouclier qui dit exactement ce qui est envoyé à Claude.
// « Claude » est grisé hors ligne ou indisponible, avec l'explication. Hors ligne, un choix « Claude » mémorisé
// devient « Auto » ; en ligne, il reste « Claude » même indisponible (le serveur répond alors une erreur claire,
// jamais Ollama en silence). Le choix est mémorisé (store de l'interface).
import { CloudOff, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useEffect, useId } from 'react'
import {
  answeringEngine,
  CLAUDE_MODEL_LABEL,
  CLAUDE_MODELS,
  claudeBlockedReason,
  effectiveChoice,
  ENGINE_CHOICES,
  ollamaReady,
  safeClaudeModel,
} from '../lib/engine.ts'
import type { AiEngine, AiStatus, ClaudeModel, EngineChoice } from '../services/types.ts'
import { useAi } from '../store/ai.ts'
import { useAppState } from '../store/app.ts'

export interface Engine {
  status: AiStatus | null
  /** Choix affiché (hors ligne : Claude → Auto ; en ligne, Claude indisponible reste Claude : erreur du serveur). */
  choice: EngineChoice
  setChoice: (choice: EngineChoice) => void
  /** Moteur qui répondra. */
  engine: AiEngine
  claudeModel: ClaudeModel
  setClaudeModel: (model: ClaudeModel) => void
  /** Modèle Ollama (null : celui du serveur). */
  ollamaModel: string | null
  setOllamaModel: (model: string | null) => void
  /** Champs à joindre aux requêtes IA. */
  request: { engine: EngineChoice; claudeModel: ClaudeModel; model?: string }
}

/** Choix du moteur mémorisé + état des moteurs (relu à l'ouverture du composant qui l'utilise). */
export function useEngine(): Engine {
  const prefs = useAppState((state) => ({
    aiEngine: state.aiEngine,
    setAiEngine: state.setAiEngine,
    claudeModel: state.claudeModel,
    setClaudeModel: state.setClaudeModel,
    aiModel: state.aiModel,
    setAiModel: state.setAiModel,
  }))
  const status = useAi((state) => state.status)
  const load = useAi((state) => state.load)
  useEffect(() => {
    void load()
  }, [load])
  const choice = effectiveChoice(prefs.aiEngine, status)
  const claudeModel = safeClaudeModel(prefs.claudeModel)
  return {
    status,
    choice,
    setChoice: prefs.setAiEngine,
    engine: answeringEngine(prefs.aiEngine, status),
    claudeModel,
    setClaudeModel: prefs.setClaudeModel,
    ollamaModel: prefs.aiModel,
    setOllamaModel: prefs.setAiModel,
    request: { engine: choice, claudeModel, ...(prefs.aiModel !== null && { model: prefs.aiModel }) },
  }
}

/**
 * sends : ce qui part vers Claude pour cette action (« Seuls … sont envoyés. »).
 * showModel : sélecteur du modèle du moteur qui répondra (masqué dans le panneau IA, qui a ses sections).
 */
export function EnginePicker({ engine, sends, showModel = true }: { engine: Engine; sends: string; showModel?: boolean }) {
  const labelId = useId()
  const { status } = engine
  const blocked = claudeBlockedReason(status)
  const ollama = status?.ollama
  const down = status !== null && (engine.engine === 'claude' ? !status.claude.available : !ollamaReady(status, engine.ollamaModel))
  const answering = engine.engine === 'claude' ? `Claude (${CLAUDE_MODEL_LABEL[engine.claudeModel]})` : 'Ollama (local)'

  return (
    <div className="space-y-2">
      <span id={labelId} className="ds-label">
        Moteur
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-sunken p-0.5 text-sm">
        {ENGINE_CHOICES.map((option) => {
          const disabled = option.id === 'claude' && blocked !== null
          const checked = engine.choice === option.id
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              title={disabled ? blocked : undefined}
              onClick={() => engine.setChoice(option.id)}
              className={`rounded-md py-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                checked ? 'bg-elevated font-medium text-fg shadow-card' : 'text-muted hover:text-fg'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      {blocked !== null && (
        <p className="flex items-start gap-1.5 text-xs text-muted">
          <CloudOff className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>Claude grisé — {blocked}</span>
        </p>
      )}
      {showModel && engine.engine === 'claude' && (
        <label className="flex items-center gap-2 text-sm">
          <span className="w-16 shrink-0 text-muted">Modèle</span>
          <select className="ds-select min-w-0 flex-1" value={engine.claudeModel} onChange={(event) => engine.setClaudeModel(safeClaudeModel(event.target.value))} aria-label="Modèle Claude">
            {CLAUDE_MODELS.map((model) => (
              <option key={model} value={model}>
                {CLAUDE_MODEL_LABEL[model]}
              </option>
            ))}
          </select>
        </label>
      )}
      {showModel && engine.engine === 'ollama' && (
        <label className="flex items-center gap-2 text-sm">
          <span className="w-16 shrink-0 text-muted">Modèle</span>
          <select
            className="ds-select min-w-0 flex-1"
            value={engine.ollamaModel ?? ''}
            onChange={(event) => engine.setOllamaModel(event.target.value === '' ? null : event.target.value)}
            aria-label="Modèle Ollama"
          >
            <option value="">Par défaut{ollama ? ` (${ollama.defaultModelName ?? ollama.defaultModel})` : ' du serveur'}</option>
            {ollama?.models.map((model) => (
              <option key={model.name} value={model.name}>
                {model.name}
                {model.parameterSize ? ` · ${model.parameterSize}` : ''}
              </option>
            ))}
            {engine.ollamaModel !== null && ollama && !ollama.models.some((model) => model.name === engine.ollamaModel) && (
              <option value={engine.ollamaModel}>{engine.ollamaModel} (non installé)</option>
            )}
          </select>
        </label>
      )}
      <p className="flex items-start gap-1.5 text-xs" data-status={down ? 'BLOCKED' : undefined}>
        {down ? <TriangleAlert className="ds-ink mt-px size-3.5 shrink-0" aria-hidden /> : <ShieldCheck className="mt-px size-3.5 shrink-0 text-muted" aria-hidden />}
        <span className={down ? 'ds-ink' : 'text-muted'}>
          {down
            ? `${engine.engine === 'claude' ? 'Claude' : 'Ollama'} n’est pas disponible : ${
                engine.engine === 'claude' ? (status?.claude.error ?? 'voir le panneau IA') : (ollama?.reachable ? 'modèle non installé (voir le panneau IA)' : (ollama?.error ?? 'injoignable'))
              }`
            : engine.engine === 'claude'
              ? `Réponse par ${answering}. ${sends}`
              : `Réponse par ${answering} : rien ne quitte cette machine.`}
        </span>
      </p>
    </div>
  )
}
