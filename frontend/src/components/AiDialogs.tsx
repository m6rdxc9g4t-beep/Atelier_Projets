// IA locale (Ollama) et Claude CLI : panneau d'état et choix du modèle, découpage d'une Story,
// session Claude CLI pour un élément. Les propositions de l'IA ne sont enregistrées qu'après validation.
import { Bot, Check, ClipboardCopy, Cpu, RefreshCw, Sparkles, SquareTerminal, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { TYPE_LABEL } from '../lib/labels.ts'
import { useAction } from '../lib/use-action.ts'
import { useApi } from '../lib/use-api.ts'
import { aiService, projectService, workItemService } from '../services/api.ts'
import { errorMessage, isAbort } from '../services/client.ts'
import type { AiStatus, BreakdownResult, ClaudeLaunchResult, ClaudePermissionMode, Project, ProposedItem } from '../services/types.ts'
import { useApp, useAppState, type DialogRequest } from '../store/app.ts'
import { Button, Field, MarkdownText, Modal, Spinner, TypeChip } from './ui.tsx'

const close = () => useApp.getState().openDialog(null)

/** Secondes écoulées depuis le début d'une génération (les modèles locaux peuvent prendre une minute). */
export function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) return
    setSeconds(0)
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [active])
  return seconds
}

export function Generating({ label, active }: { label: string; active: boolean }) {
  const seconds = useElapsed(active)
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-sunken p-4" role="status">
      <Spinner label={label} />
      <span className="ml-auto text-xs tabular-nums text-muted">{seconds} s</span>
    </div>
  )
}

/** Modèle à utiliser : choix du panneau IA, sinon celui du serveur. */
export function useAiModel(): string | undefined {
  return useApp((state) => state.aiModel) ?? undefined
}

function sizeLabel(bytes: number): string {
  return bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(1)} Go` : ''
}

function StatusLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className="ds-badge" data-status={ok ? 'CLOSED' : 'REJECTED'}>
      {children}
    </span>
  )
}

// --- Claude CLI en un clic --------------------------------------------------------------------------

/**
 * Ouvre Claude CLI tout de suite dans le dépôt du projet : avec la tâche en prompt (workItemId), ou
 * sans prompt (session sur le projet). Sans dépôt local, le chemin est demandé une fois.
 */
export async function launchClaudeNow(project: Project, workItemId: number | null): Promise<void> {
  const { notify, openDialog } = useApp.getState()
  if (!project.localRepoPath) {
    openDialog({ kind: 'linkRepo', workItemId })
    return
  }
  try {
    const result = await aiService.launchClaude(workItemId !== null ? { workItemId } : { projectId: project.id })
    if (result.launched) {
      notify('success', workItemId !== null ? `Claude s’ouvre dans le Terminal avec la tâche #${workItemId}…` : 'Claude s’ouvre dans le Terminal…')
      return
    }
    // Hors macOS : pas d'ouverture automatique, la commande est copiée.
    await navigator.clipboard?.writeText(result.command).catch(() => undefined)
    notify('info', `Commande copiée, à coller dans un terminal : ${result.command}`)
  } catch (error) {
    notify('error', errorMessage(error))
  }
}

/** Bouton « Claude CLI » : un clic ouvre Claude ; indicateur pendant l'ouverture. */
export function ClaudeLaunchButton({ project, workItemId, label = 'Claude CLI' }: { project: Project; workItemId: number | null; label?: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm"
      variant="primary"
      icon={<SquareTerminal className="size-3.5" />}
      busy={busy}
      title={workItemId !== null ? 'Ouvrir Claude CLI dans le dépôt du projet avec cette tâche en prompt' : 'Ouvrir Claude CLI dans le dépôt du projet'}
      onClick={async () => {
        setBusy(true)
        await launchClaudeNow(project, workItemId)
        setBusy(false)
      }}
    >
      {label}
    </Button>
  )
}

/** Dépôt local manquant : demandé une fois, enregistré dans le projet, puis Claude s'ouvre. */
export function LinkRepoDialog({ project, request }: { project: Project; request: Extract<DialogRequest, { kind: 'linkRepo' }> }) {
  const [path, setPath] = useState('')
  const { busy, run } = useAction()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const outcome = await run('save', () => projectService.update(project.id, { localRepoPath: path.trim() }), 'Dépôt relié au projet')
    if (!outcome.ok) return
    close()
    await launchClaudeNow(outcome.value, request.workItemId)
  }
  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <SquareTerminal className="size-5 text-accent-ink" aria-hidden /> Où se trouve le code de « {project.name} » ?
        </span>
      }
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Annuler
          </Button>
          <Button type="submit" form="link-repo-form" variant="primary" busy={busy === 'save'} disabled={path.trim() === ''}>
            Enregistrer et ouvrir Claude
          </Button>
        </>
      }
    >
      <form id="link-repo-form" onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted">Claude CLI s’ouvre dans le dépôt Git du projet. Indique son chemin une fois : il est gardé dans les paramètres du projet.</p>
        <Field label="Dépôt Git local (chemin absolu)" hint="Dans le Finder : clic droit sur le dossier, Option enfoncée, « Copier … comme nom de chemin »">
          <input
            className="ds-input font-mono"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/Users/…/mon-projet"
            spellCheck={false}
            required
          />
        </Field>
      </form>
    </Modal>
  )
}

// --- Panneau « IA Locale » -------------------------------------------------------------------------

export function AiPanel({ project }: { project: Project | undefined }) {
  const status = useApi(() => aiService.status(), [])
  const { aiModel, setAiModel } = useAppState((state) => ({ aiModel: state.aiModel, setAiModel: state.setAiModel }))

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <Bot className="size-5 text-accent-ink" aria-hidden /> IA locale &amp; Claude CLI
        </span>
      }
      onClose={close}
      width="max-w-2xl"
      footer={
        <Button icon={<RefreshCw className="size-4" />} busy={status.loading} onClick={status.reload}>
          Actualiser
        </Button>
      }
    >
      {status.error && <p className="text-muted">{status.error.message}</p>}
      {!status.data && !status.error && <Spinner />}
      {status.data && <AiStatusContent status={status.data} aiModel={aiModel} setAiModel={setAiModel} project={project} />}
    </Modal>
  )
}

function AiStatusContent({
  status,
  aiModel,
  setAiModel,
  project,
}: {
  status: AiStatus
  aiModel: string | null
  setAiModel: (model: string | null) => void
  project: Project | undefined
}) {
  const { ollama, claude } = status
  const selected = aiModel ?? ollama.defaultModelName ?? ollama.defaultModel
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="flex flex-wrap items-center gap-2 font-semibold">
          <Cpu className="size-4 text-muted" aria-hidden /> Ollama
          <StatusLine ok={ollama.reachable}>{ollama.reachable ? 'Connecté' : 'Injoignable'}</StatusLine>
          <span className="font-mono text-xs font-normal text-muted">{ollama.url}</span>
        </h3>
        {!ollama.reachable && (
          <div className="rounded-lg bg-sunken p-3 text-sm">
            <p className="mb-2 text-muted">{ollama.error}</p>
            <p>
              Installer Ollama (ollama.com), puis dans un terminal : <code className="font-mono">ollama pull qwen2.5-coder</code>
            </p>
          </div>
        )}
        {ollama.reachable && ollama.models.length === 0 && (
          <p className="rounded-lg bg-sunken p-3 text-sm">
            Aucun modèle installé : <code className="font-mono">ollama pull qwen2.5-coder</code> (ou <code className="font-mono">gemma3</code>).
          </p>
        )}
        {ollama.models.length > 0 && (
          <fieldset className="space-y-1">
            <legend className="mb-2 text-sm text-muted">Modèle utilisé pour le découpage des stories et le résumé des commits</legend>
            <ModelOption
              checked={aiModel === null}
              onSelect={() => setAiModel(null)}
              title={`Par défaut du serveur : ${ollama.defaultModel}`}
              detail={
                ollama.defaultModelName
                  ? `OLLAMA_MODEL${ollama.defaultModelName !== ollama.defaultModel ? ` → ${ollama.defaultModelName}` : ''}`
                  : `non installé : ollama pull ${ollama.defaultModel}`
              }
              warn={!ollama.defaultModelInstalled}
            />
            {ollama.models.map((model) => (
              <ModelOption
                key={model.name}
                checked={aiModel === model.name}
                onSelect={() => setAiModel(model.name)}
                title={model.name}
                detail={[model.parameterSize, model.family, sizeLabel(model.size)].filter(Boolean).join(' · ')}
              />
            ))}
          </fieldset>
        )}
        {aiModel !== null && !ollama.models.some((model) => model.name === aiModel) && (
          <p className="flex items-center gap-2 text-sm" data-status="BLOCKED">
            <TriangleAlert className="ds-ink size-4" aria-hidden /> Le modèle choisi « {aiModel} » n’est plus installé.
          </p>
        )}
        <p className="text-xs text-muted">Modèle actif : {selected}. Les données ne quittent pas cette machine.</p>
      </section>

      <section className="space-y-3 border-t border-line pt-5">
        <h3 className="flex flex-wrap items-center gap-2 font-semibold">
          <SquareTerminal className="size-4 text-muted" aria-hidden /> Claude CLI
          <StatusLine ok={claude.available}>{claude.available ? 'Disponible' : 'Introuvable'}</StatusLine>
          {claude.version && <span className="text-xs font-normal text-muted">{claude.version}</span>}
        </h3>
        <p className="break-all font-mono text-xs text-muted">{claude.command}</p>
        {claude.error && <p className="text-sm text-muted">{claude.error}</p>}
        <p className="text-sm text-muted">
          Un clic sur « Claude CLI » (ici, ou dans la fiche d’un élément pour lui donner la tâche en prompt) ouvre Claude dans le dépôt du
          projet{claude.canOpenTerminal ? ` (application ${claude.terminalApp}).` : ' (commande copiée, à coller dans un terminal).'}
        </p>
        {project && claude.available && <ClaudeLaunchButton project={project} workItemId={null} label={`Claude CLI sur « ${project.name} »`} />}
      </section>
    </div>
  )
}

function ModelOption({ checked, onSelect, title, detail, warn }: { checked: boolean; onSelect: () => void; title: string; detail: string; warn?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${checked ? 'border-accent bg-accent-soft' : 'border-line hover:bg-hover'}`}>
      <input type="radio" name="ai-model" checked={checked} onChange={onSelect} className="accent-[var(--accent)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm">{title}</span>
        <span className={`block text-xs ${warn ? '' : 'text-muted'}`} data-status={warn ? 'BLOCKED' : undefined}>
          <span className={warn ? 'ds-ink' : ''}>{detail}</span>
        </span>
      </span>
    </label>
  )
}

// --- ✨ Générer les sous-tâches d'une Story --------------------------------------------------------

interface Draft extends ProposedItem {
  key: number
  selected: boolean
  estimateText: string
}

function toDrafts(result: BreakdownResult): Draft[] {
  return result.items.map((item, index) => ({ ...item, key: index, selected: true, estimateText: String(item.estimate.days) }))
}

export function BreakdownDialog({ request }: { request: Extract<DialogRequest, { kind: 'breakdown' }> }) {
  const model = useAiModel()
  const [instructions, setInstructions] = useState('')
  const [result, setResult] = useState<BreakdownResult | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { busy, run } = useAction()
  const pending = useRef<AbortController | null>(null)
  // Dialogue fermé pendant une génération : la requête est annulée (et Ollama libéré côté backend).
  useEffect(() => () => pending.current?.abort(), [])

  const generate = async () => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setGenerating(true)
    setError(null)
    try {
      const value = await aiService.breakdown(
        {
          storyId: request.storyId,
          ...(model && { model }),
          ...(instructions.trim() && { instructions: instructions.trim() }),
        },
        controller.signal,
      )
      setResult(value)
      setDrafts(toDrafts(value))
    } catch (reason) {
      if (!isAbort(reason)) setError(errorMessage(reason))
    } finally {
      if (pending.current === controller) {
        pending.current = null
        setGenerating(false)
      }
    }
  }

  const update = (key: number, patch: Partial<Draft>) => setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)))
  const chosen = drafts.filter((draft) => draft.selected && draft.title.trim() !== '')
  const invalid = chosen.some((draft) => !(Number(draft.estimateText.replace(',', '.')) > 0))
  const totalDays = chosen.reduce((sum, draft) => sum + (Number(draft.estimateText.replace(',', '.')) || 0), 0)

  const create = async () => {
    const outcome = await run(
      'create',
      () =>
        workItemService.createMany(
          request.storyId,
          chosen.map((draft) => ({
            type: draft.type,
            title: draft.title.trim(),
            description: draft.description,
            estimatedDays: Number(draft.estimateText.replace(',', '.')),
          })),
        ),
      `${chosen.length} élément(s) créé(s) dans ${request.label}`,
    )
    if (outcome.ok) close()
  }

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-5 text-accent-ink" aria-hidden /> Générer les sous-tâches · {request.label}
        </span>
      }
      onClose={close}
      width="max-w-3xl"
      guard={generating || result !== null}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted">
            {result ? `${chosen.length} élément(s) retenu(s) · ${totalDays.toFixed(2)} j · modèle ${result.model}` : `Modèle : ${model ?? 'par défaut du serveur'}`}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close}>
              {generating ? 'Arrêter et fermer' : 'Annuler'}
            </Button>
            {result ? (
              <>
                <Button icon={<RefreshCw className="size-4" />} onClick={generate} disabled={generating || busy !== null}>
                  Régénérer
                </Button>
                <Button variant="primary" icon={<Check className="size-4" />} busy={busy === 'create'} disabled={chosen.length === 0 || invalid || generating} onClick={create}>
                  Créer {chosen.length} élément(s)
                </Button>
              </>
            ) : (
              <Button variant="primary" icon={<Sparkles className="size-4" />} busy={generating} onClick={generate}>
                Générer
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Consignes pour l’IA (facultatif)" hint="Ex. : « pas de tâches de documentation », « prévoir les tests e2e »">
          <textarea className="ds-textarea min-h-16 font-sans text-sm" value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={2000} />
        </Field>
        {generating && <Generating label="L’IA locale découpe la story…" active={generating} />}
        {error && (
          <p className="rounded-lg bg-sunken p-3 text-sm" role="alert" data-status="REJECTED">
            <span className="ds-ink">{error}</span>
          </p>
        )}
        {result && !generating && (
          <ul className="space-y-2" aria-label="Propositions">
            {drafts.map((draft) => (
              <li key={draft.key} className={`rounded-lg border p-3 ${draft.selected ? 'border-line' : 'border-line opacity-60'}`}>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.selected}
                    onChange={(event) => update(draft.key, { selected: event.target.checked })}
                    aria-label={`Retenir « ${draft.title} »`}
                    className="accent-[var(--accent)]"
                  />
                  <button
                    type="button"
                    data-type={draft.type}
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs font-semibold"
                    title="Basculer Feature / Task"
                    onClick={() => update(draft.key, { type: draft.type === 'FEATURE' ? 'TASK' : 'FEATURE' })}
                  >
                    <TypeChip type={draft.type} />
                    <span className="ds-ink">{TYPE_LABEL[draft.type]}</span>
                  </button>
                  <input
                    className="ds-input min-w-0 flex-1"
                    value={draft.title}
                    maxLength={200}
                    onChange={(event) => update(draft.key, { title: event.target.value })}
                    aria-label="Titre"
                  />
                  <input
                    className="ds-input w-20 text-right"
                    inputMode="decimal"
                    value={draft.estimateText}
                    onChange={(event) => update(draft.key, { estimateText: event.target.value })}
                    aria-label="Estimation en jours"
                  />
                  <span className="text-sm text-muted">j</span>
                </div>
                {draft.description && (
                  <details className="mt-2 pl-7">
                    <summary className="cursor-pointer text-xs text-muted">Description et critères</summary>
                    <div className="mt-2 text-sm">
                      <MarkdownText empty="">{draft.description}</MarkdownText>
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
        {result && !generating && (
          <p className="text-xs text-muted">Titres, types et estimations restent modifiables : rien n’est créé avant « Créer ».</p>
        )}
      </div>
    </Modal>
  )
}

// --- Session Claude CLI ---------------------------------------------------------------------------

const PERMISSION_LABEL: Record<ClaudePermissionMode, string> = {
  default: 'Manuel : Claude demande avant chaque action',
  plan: 'Plan d’abord : Claude propose un plan sans rien modifier',
  acceptEdits: 'Accepter les modifications de fichiers sans demander',
}

export function ClaudeDialog({ request }: { request: Extract<DialogRequest, { kind: 'claude' }> }) {
  const preview = useApi(() => aiService.claudePrompt(request.workItemId), [request.workItemId])
  const status = useApi(() => aiService.status(), [])
  const [prompt, setPrompt] = useState<string | null>(null)
  const [mode, setMode] = useState<ClaudePermissionMode>('default')
  const [launched, setLaunched] = useState<ClaudeLaunchResult | null>(null)
  const [copied, setCopied] = useState(false)
  const { busy, run } = useAction()
  const text = prompt ?? preview.data?.prompt ?? ''
  const canOpenTerminal = status.data?.claude.canOpenTerminal ?? false

  const launch = async () => {
    const outcome = await run(
      'launch',
      () => aiService.launchClaude({ workItemId: request.workItemId, permissionMode: mode, ...(prompt !== null && prompt.trim() !== '' && { prompt }) }),
      canOpenTerminal ? `Session Claude CLI ouverte dans ${status.data?.claude.terminalApp ?? 'le terminal'}` : undefined,
    )
    if (outcome.ok) setLaunched(outcome.value)
  }

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      useApp.getState().notify('error', 'Copie impossible : sélectionner la commande à la main.')
    }
  }

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <SquareTerminal className="size-5 text-accent-ink" aria-hidden /> Claude CLI · #{request.workItemId}
        </span>
      }
      onClose={close}
      guard={prompt !== null}
      width="max-w-3xl"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Fermer
          </Button>
          <Button
            variant="primary"
            icon={<SquareTerminal className="size-4" />}
            busy={busy === 'launch'}
            disabled={!preview.data?.cwd || text.trim() === ''}
            onClick={launch}
          >
            {canOpenTerminal ? `Ouvrir dans ${status.data?.claude.terminalApp ?? 'le Terminal'}` : 'Préparer la commande'}
          </Button>
        </div>
      }
    >
      {preview.error && <p className="text-muted">{preview.error.message}</p>}
      {!preview.data && !preview.error && <Spinner />}
      {preview.data && (
        <div className="space-y-4">
          {status.data && !status.data.claude.available && (
            <p className="rounded-lg bg-sunken p-3 text-sm" data-status="BLOCKED">
              <span className="ds-ink">{status.data.claude.error}</span> — la commande reste utilisable une fois Claude CLI installé.
            </p>
          )}
          {preview.data.cwd ? (
            <p className="text-sm text-muted">
              Dossier de la session : <span className="break-all font-mono text-fg">{preview.data.cwd}</span>
            </p>
          ) : (
            <p className="rounded-lg bg-sunken p-3 text-sm" data-status="BLOCKED">
              <span className="ds-ink">Aucun dépôt Git local pour ce projet.</span>{' '}
              <button
                type="button"
                className="text-accent-ink underline underline-offset-2"
                onClick={() => {
                  useApp.getState().setView('settings')
                  close()
                }}
              >
                Le renseigner dans les paramètres
              </button>
            </p>
          )}
          <Field label="Prompt initial (modifiable)">
            <textarea className="ds-textarea min-h-72" value={text} onChange={(event) => setPrompt(event.target.value)} maxLength={50_000} />
          </Field>
          <Field label="Permissions de la session">
            <select className="ds-select" value={mode} onChange={(event) => setMode(event.target.value as ClaudePermissionMode)}>
              {(Object.keys(PERMISSION_LABEL) as ClaudePermissionMode[]).map((value) => (
                <option key={value} value={value}>
                  {PERMISSION_LABEL[value]}
                </option>
              ))}
            </select>
          </Field>
          {launched && (
            <div className="space-y-2 rounded-lg border border-line bg-sunken p-3">
              <p className="text-sm">
                {launched.launched ? 'Session ouverte. Pour la relancer à la main :' : 'Coller cette commande dans un terminal :'}
              </p>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface p-2 font-mono text-xs">{launched.command}</pre>
              <Button size="sm" icon={copied ? <Check className="size-3.5" /> : <ClipboardCopy className="size-3.5" />} onClick={() => copy(launched.command)}>
                {copied ? 'Copiée' : 'Copier la commande'}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
