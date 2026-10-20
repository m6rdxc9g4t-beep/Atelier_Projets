// Maquette C : fiche d'un élément (#ID) — statut, priorité, avancement, budget & temps, double onglet
// Description / Journal d'avancement, commits Git et Pull Requests GitHub rattachés automatiquement.
import {
  Bot,
  Check,
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Hammer,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button, ErrorNotice, Field, MarkdownText, PriorityBadge, Spinner, StatusBadge, Tabs, TypeChip } from '../components/ui.tsx'
import { dateTime, days, fromNow, hours, longDate, parseNumber, signedDays, today } from '../lib/format.ts'
import { levelCode, PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, STATUSES, TYPE_LABEL, WORK_ITEM_TYPES } from '../lib/labels.ts'
import { useAction } from '../lib/use-action.ts'
import { useApi } from '../lib/use-api.ts'
import { ClaudeLaunchButton, Generating, SENDS } from '../components/AiDialogs.tsx'
import { EnginePicker, useEngine } from '../components/EnginePicker.tsx'
import { CLAUDE_MODEL_LABEL, engineResultLabel } from '../lib/engine.ts'
import { DependenciesSection } from '../components/Dependencies.tsx'
import { TimerButton } from '../components/Timer.tsx'
import { aiService, gitService, workItemService } from '../services/api.ts'
import { ApiError, errorMessage, isAbort } from '../services/client.ts'
import type { Priority, Project, SummarizeResult, WorkItemDetail, WorkItemStatus, WorkItemType } from '../services/types.ts'
import { useApp } from '../store/app.ts'

type Tab = 'description' | 'log'

export function TaskSlideOver({ workItemId, project }: { workItemId: number; project: Project }) {
  const close = () => useApp.getState().openWorkItem(null)
  const hoursPerDay = useApp((state) => state.hoursPerDay) ?? undefined
  const detail = useApi(() => workItemService.get(workItemId, { hoursPerDay }), [workItemId, hoursPerDay])

  // Élément supprimé entre-temps (avec sa story, son epic…) : la fiche se ferme.
  const gone = detail.error instanceof ApiError && detail.error.status === 404
  useEffect(() => {
    if (!gone) return
    useApp.getState().notify('info', `L’élément #${workItemId} n’existe plus.`)
    close()
  }, [gone, workItemId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Échap ferme la fiche, sauf si un menu ou un dialogue l'a traité, ou pendant une saisie.
      const target = event.target as HTMLElement | null
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]')
      if (event.key !== 'Escape' || event.defaultPrevented || typing) return
      if (!document.querySelector('[role="dialog"][aria-modal="true"]')) close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <div className="fixed inset-0 z-30 bg-backdrop xl:hidden" onClick={close} aria-hidden />
      <aside
        aria-label={`Fiche de l’élément #${workItemId}`}
        className="ds-card fixed inset-y-0 right-0 z-40 flex w-[min(30rem,100vw)] flex-col rounded-none border-y-0 border-r-0 shadow-overlay xl:static xl:z-auto xl:w-[28rem] xl:shadow-card 2xl:w-[32rem]"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-3">
          <span className="text-sm text-muted">Fiche élément</span>
          <div className="flex items-center gap-1">
            <ClaudeLaunchButton project={project} workItemId={workItemId} />
            <Button
              variant="ghost"
              size="sm"
              icon={<SlidersHorizontal className="size-4" />}
              aria-label="Options de Claude CLI (prompt, permissions)"
              title="Options de Claude CLI : modifier le prompt, choisir les permissions"
              onClick={() => useApp.getState().openDialog({ kind: 'claude', workItemId })}
            />
            <Button variant="ghost" size="sm" icon={<X className="size-4" />} aria-label="Fermer la fiche" onClick={close} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {detail.error && (
            <div className="p-4">
              <ErrorNotice error={detail.error} onRetry={detail.reload} />
            </div>
          )}
          {!detail.data && !detail.error && (
            <div className="p-5">
              <Spinner />
            </div>
          )}
          {detail.data && !detail.error && <TaskContent item={detail.data} />}
        </div>
      </aside>
    </>
  )
}

/** Valeur affichée tout de suite à la saisie, réalignée sur l'API à chaque relecture (contrôle jamais désactivé). */
function useLocalValue<T>(value: T): [T, (next: T) => void] {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  return [local, setLocal]
}

function TaskContent({ item }: { item: WorkItemDetail }) {
  const [tab, setTab] = useState<Tab>('description')
  const { busy, run } = useAction()
  const update = (id: string, body: Parameters<typeof workItemService.update>[1], success?: string) =>
    run(id, () => workItemService.update(item.id, body), success)
  const [status, setStatus] = useLocalValue(item.status)
  const [priority, setPriority] = useLocalValue(item.priority)

  return (
    <div className="divide-y divide-line">
      <section className="space-y-4 p-5">
        <TitleBlock item={item} onRename={(title) => update('title', { title }, 'Titre modifié')} busy={busy === 'title'} />
        <nav aria-label="Parents" className="flex flex-wrap items-center gap-1 text-xs text-muted">
          {[
            { type: 'PHASE' as const, ref: item.path.phase },
            { type: 'EPIC' as const, ref: item.path.epic },
            { type: 'STORY' as const, ref: item.path.story },
          ].map((parent, index) => (
            <span key={parent.type} className="flex items-center gap-1" title={parent.ref.title}>
              {index > 0 && <ChevronRight className="size-3" aria-hidden />}
              <TypeChip type={parent.type} />
              <span className="ds-ink font-semibold" data-type={parent.type}>
                {levelCode(parent.type, parent.ref.code)}
              </span>
              <span className="max-w-[9rem] truncate">{parent.ref.title}</span>
            </span>
          ))}
        </nav>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Statut">
            <span className="relative block" data-status={status}>
              <span className="ds-dot pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
              <select
                className="ds-select pl-7 font-semibold"
                value={status}
                aria-busy={busy === 'status'}
                onChange={async (event) => {
                  const next = event.target.value as WorkItemStatus
                  setStatus(next)
                  if (!(await update('status', { status: next }, 'Statut mis à jour')).ok) setStatus(item.status)
                }}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
            </span>
          </Field>
          <Field label="Priorité">
            <select
              className="ds-select"
              value={priority}
              aria-busy={busy === 'priority'}
              onChange={async (event) => {
                const next = event.target.value as Priority
                setPriority(next)
                if (!(await update('priority', { priority: next }, 'Priorité mise à jour')).ok) setPriority(item.priority)
              }}
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABEL[priority]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={item.status} code />
          <PriorityBadge priority={item.priority} />
          {(item.startDate || item.dueDate) && (
            <span className="text-xs text-muted">
              {longDate(item.startDate)} → {longDate(item.dueDate)}
            </span>
          )}
        </div>
        <ProgressControl item={item} onCommit={(progress) => update('progress', { progress })} />
      </section>

      <BudgetSection item={item} />

      <DependenciesSection item={item} />

      <section>
        <Tabs
          label="Contenu de l’élément"
          value={tab}
          onChange={setTab}
          className="px-3"
          tabs={[
            {
              id: 'description',
              label: (
                <>
                  <NotebookPen className="size-4" aria-hidden /> Description (À faire)
                </>
              ),
            },
            {
              id: 'log',
              label: (
                <>
                  <Hammer className="size-4" aria-hidden /> Journal d’avancement
                </>
              ),
            },
          ]}
        />
        <div className="p-5">
          {/* Les deux onglets restent montés : un brouillon ou un résumé en cours survit au changement d'onglet. */}
          <div hidden={tab !== 'description'}>
            <MarkdownEditor
              key={`description-${item.id}`}
              value={item.description}
              empty="Aucune description. Décrivez ce qu’il faut faire et les critères d’acceptation."
              busy={busy === 'description'}
              onSave={(description) => update('description', { description }, 'Description enregistrée')}
            />
          </div>
          <div hidden={tab !== 'log'}>
            <LogTab item={item} />
          </div>
        </div>
      </section>

      <GitSection item={item} />

      <DangerZone item={item} />
    </div>
  )
}

function TitleBlock({ item, onRename, busy }: { item: WorkItemDetail; onRename: (title: string) => Promise<unknown>; busy: boolean }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.title)
  const { busy: typeBusy, run } = useAction()
  const [type, setType] = useLocalValue(item.type)

  if (editing) {
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={async (event) => {
          event.preventDefault()
          if (title.trim() === '' || title === item.title) return setEditing(false)
          await onRename(title.trim())
          setEditing(false)
        }}
      >
        <input className="ds-input text-base font-semibold" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Titre" autoFocus maxLength={200} />
        <Button type="submit" variant="primary" size="sm" busy={busy} icon={<Check className="size-4" />} aria-label="Enregistrer le titre" />
        <Button size="sm" variant="ghost" icon={<X className="size-4" />} aria-label="Annuler" onClick={() => setEditing(false)} />
      </form>
    )
  }

  return (
    <div className="flex items-start gap-3">
      <span className="mt-1.5" data-type={item.type}>
        <TypeChip type={item.type} size="lg" />
      </span>
      <h2 className="min-w-0 flex-1 text-lg font-semibold leading-snug">
        <span className="ds-ink uppercase" data-type={item.type}>
          {TYPE_LABEL[item.type]} #{item.id}
        </span>{' '}
        — {item.title}
      </h2>
      <div className="flex shrink-0 items-center gap-1">
        <select
          className="ds-select h-8 min-h-0 w-auto py-0 text-xs"
          aria-label="Type"
          value={type}
          aria-busy={typeBusy !== null}
          onChange={async (event) => {
            const next = event.target.value as WorkItemType
            setType(next)
            const result = await run('type', () => workItemService.update(item.id, { type: next }), 'Type modifié')
            if (!result.ok) setType(item.type)
          }}
        >
          {WORK_ITEM_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABEL[type]}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="sm"
          icon={<Pencil className="size-4" />}
          aria-label="Modifier le titre"
          onClick={() => {
            setTitle(item.title)
            setEditing(true)
          }}
        />
      </div>
    </div>
  )
}

function ProgressControl({ item, onCommit }: { item: WorkItemDetail; onCommit: (progress: number) => void }) {
  const [value, setValue] = useLocalValue(item.progress)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const done = item.status === 'RESOLVED' || item.status === 'CLOSED'

  // Enregistre la valeur une fois le curseur immobile (souris ou flèches du clavier) ; jamais désactivé
  // pendant l'enregistrement, pour garder le focus clavier.
  const schedule = (next: number) => {
    setValue(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (next !== item.progress) onCommit(next)
    }, 450)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <label htmlFor={`progress-${item.id}`} className="font-medium text-muted">
          Avancement déclaré
        </label>
        <span className="font-semibold tabular-nums">{value}%</span>
      </div>
      <input
        id={`progress-${item.id}`}
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        disabled={done}
        title={done ? 'Un élément résolu ou terminé est à 100 %' : undefined}
        onChange={(event) => schedule(Number(event.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </div>
  )
}

function BudgetSection({ item }: { item: WorkItemDetail }) {
  const [adding, setAdding] = useState(false)
  const [editingEstimate, setEditingEstimate] = useState(false)
  const [estimate, setEstimate] = useState('')
  const [entry, setEntry] = useState({ hours: '', spentOn: today(), comment: '' })
  const [showEntries, setShowEntries] = useState(false)
  const { busy, run } = useAction()

  const submitTime = async (event: FormEvent) => {
    event.preventDefault()
    const value = parseNumber(entry.hours)
    if (value === null || value <= 0) return useApp.getState().notify('error', 'Saisir un nombre d’heures supérieur à 0.')
    const result = await run(
      'time',
      () => workItemService.addTime(item.id, { hours: value, spentOn: entry.spentOn, ...(entry.comment.trim() && { comment: entry.comment.trim() }) }),
      `${hours(value)} saisies sur #${item.id}`,
    )
    if (result.ok) {
      setEntry({ hours: '', spentOn: today(), comment: '' })
      setAdding(false)
      setShowEntries(true)
    }
  }

  const submitEstimate = async (event: FormEvent) => {
    event.preventDefault()
    const value = parseNumber(estimate)
    if (estimate.trim() !== '' && (value === null || value < 0)) return useApp.getState().notify('error', 'Estimation invalide.')
    const result = await run('estimate', () => workItemService.update(item.id, { estimatedDays: value }), 'Estimation mise à jour')
    if (result.ok) setEditingEstimate(false)
  }

  return (
    <section className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Budget &amp; Temps</h3>
        <div className="flex items-center gap-2">
          <TimerButton workItemId={item.id} />
          <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding((value) => !value)} aria-expanded={adding}>
            Saisir temps
          </Button>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-3">
        <div>
          <dt className="text-xs text-muted">Estimée</dt>
          {editingEstimate ? (
            <form onSubmit={submitEstimate} className="mt-1 flex items-center gap-1">
              <input
                className="ds-input h-8 min-h-0 w-20 py-0"
                inputMode="decimal"
                value={estimate}
                onChange={(event) => setEstimate(event.target.value)}
                aria-label="Estimation en jours"
                placeholder="j"
                autoFocus
              />
              <Button type="submit" size="sm" variant="primary" busy={busy === 'estimate'} icon={<Check className="size-4" />} aria-label="Enregistrer l’estimation" />
            </form>
          ) : (
            <dd>
              <button
                type="button"
                className="group flex items-center gap-1 text-base font-semibold"
                onClick={() => {
                  setEstimate(item.estimate ? String(item.estimate.days) : '')
                  setEditingEstimate(true)
                }}
                title="Modifier l’estimation (en jours)"
              >
                {item.estimate ? days(item.estimate, 2) : 'Non estimé'}
                <Pencil className="size-3 text-muted opacity-0 group-hover:opacity-100" aria-hidden />
              </button>
              {item.estimate && <span className="text-xs text-muted">{hours(item.estimate.hours)}</span>}
            </dd>
          )}
        </div>
        <div>
          <dt className="text-xs text-muted">Réalisé</dt>
          <dd className="text-base font-semibold">{days(item.spent, 2)}</dd>
          <dd className="text-xs text-muted">{hours(item.spent.hours)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Bilan</dt>
          <dd className="mt-0.5">
            {item.balance ? (
              <span className="ds-badge" data-balance={item.balance.kind}>
                {item.balance.kind === 'REMAINING' ? `${days(item.balance.delta, 2)} rest.` : signedDays(item.balance.delta)}
              </span>
            ) : (
              <span className="text-muted">—</span>
            )}
          </dd>
        </div>
      </dl>

      {adding && (
        <form onSubmit={submitTime} className="grid grid-cols-[6rem_1fr] gap-3 rounded-lg border border-line bg-sunken p-3">
          <Field label="Heures">
            <input className="ds-input" inputMode="decimal" placeholder="4.5" value={entry.hours} onChange={(event) => setEntry({ ...entry, hours: event.target.value })} autoFocus required />
          </Field>
          <Field label="Date">
            <input className="ds-input" type="date" value={entry.spentOn} max={today()} onChange={(event) => setEntry({ ...entry, spentOn: event.target.value })} required />
          </Field>
          <div className="col-span-2">
            <Field label="Commentaire (facultatif)">
              <input className="ds-input" value={entry.comment} maxLength={2000} onChange={(event) => setEntry({ ...entry, comment: event.target.value })} />
            </Field>
          </div>
          <div className="col-span-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Annuler
            </Button>
            <Button size="sm" type="submit" variant="primary" busy={busy === 'time'}>
              Ajouter
            </Button>
          </div>
        </form>
      )}

      {item.timeEntries.length > 0 && (
        <div>
          <button type="button" className="text-sm text-accent-ink hover:underline" onClick={() => setShowEntries((value) => !value)} aria-expanded={showEntries}>
            {showEntries ? 'Masquer' : 'Afficher'} les saisies ({item.timeEntries.length})
          </button>
          {showEntries && (
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
              {item.timeEntries.map((timeEntry) => (
                <li key={timeEntry.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-24 shrink-0 text-muted">{longDate(timeEntry.spentOn)}</span>
                  <span className="w-12 shrink-0 font-semibold tabular-nums">{hours(timeEntry.duration.hours)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted" title={timeEntry.comment}>
                    {timeEntry.comment}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 className="size-3.5" />}
                    aria-label="Supprimer la saisie"
                    busy={busy === `remove-${timeEntry.id}`}
                    onClick={() => run(`remove-${timeEntry.id}`, () => workItemService.removeTime(timeEntry.id), 'Saisie supprimée')}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function MarkdownEditor({
  value,
  empty,
  busy,
  onSave,
  extraActions,
}: {
  value: string
  empty: string
  busy: boolean
  onSave: (value: string) => Promise<{ ok: boolean }>
  extraActions?: ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  if (editing) {
    return (
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault()
          const result = await onSave(draft)
          if (result.ok) setEditing(false)
        }}
      >
        <textarea className="ds-textarea min-h-64" value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Texte Markdown" autoFocus />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">Markdown : ### titres, - [ ] cases à cocher, `code`</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Annuler
            </Button>
            <Button size="sm" type="submit" variant="primary" busy={busy}>
              Enregistrer
            </Button>
          </div>
        </div>
      </form>
    )
  }

  return (
    <div className="space-y-4">
      <MarkdownText empty={empty}>{value}</MarkdownText>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          icon={<Pencil className="size-3.5" />}
          onClick={() => {
            setDraft(value)
            setEditing(true)
          }}
        >
          Modifier
        </Button>
        {extraActions}
      </div>
    </div>
  )
}

function LogTab({ item }: { item: WorkItemDetail }) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [spent, setSpent] = useState('')
  const [summary, setSummary] = useState<SummarizeResult | null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const engine = useEngine()
  const { busy, run } = useAction()

  // 🤖 Résumer mes commits : l'IA (Ollama ou Claude) rédige l'entrée à partir des git diff ; elle reste modifiable
  // dans le formulaire et n'est enregistrée qu'avec « Ajouter au journal ».
  const pending = useRef<AbortController | null>(null)
  // Fiche fermée pendant un résumé : la requête est annulée (Ollama ou Claude interrompu côté backend).
  useEffect(() => () => pending.current?.abort(), [])

  const summarize = async () => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setSummarizing(true)
    try {
      const result = await aiService.summarize({ workItemId: item.id, ...engine.request }, controller.signal)
      // Un brouillon saisi à la main est conservé : le résumé s'ajoute à la suite (ou remplace le précédent résumé).
      setText((current) => (current.trim() === '' || current === summary?.text ? result.text : `${current.trimEnd()}\n\n${result.text}`))
      setSummary(result)
      setAdding(true)
    } catch (error) {
      if (!isAbort(error)) useApp.getState().notify('error', errorMessage(error))
    } finally {
      if (pending.current === controller) {
        pending.current = null
        setSummarizing(false)
      }
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = parseNumber(spent)
    if (spent.trim() !== '' && (value === null || value < 0 || value > 24)) {
      return useApp.getState().notify('error', 'Heures mentionnées : entre 0 et 24.')
    }
    const result = await run(
      'append',
      () => workItemService.appendLog(item.id, { text: text.trim(), ...(value !== null && { hours: value }) }),
      'Entrée ajoutée au journal',
    )
    if (result.ok) {
      setText('')
      setSpent('')
      setAdding(false)
      setSummary(null)
    }
  }

  return (
    <div className="space-y-4">
      {item.commits.length > 0 && (
        <details className="rounded-lg border border-line p-3" open={engine.choice !== 'auto' || undefined}>
          <summary className="cursor-pointer text-sm text-muted">
            Résumé des commits · moteur{' '}
            <span className="font-medium text-fg">
              {engine.engine === 'claude' ? `Claude (${CLAUDE_MODEL_LABEL[engine.claudeModel]})` : 'Ollama (local)'}
            </span>
          </summary>
          <div className="mt-3">
            <EnginePicker engine={engine} sends={SENDS.summary(engine.status?.maxDiffChars ?? 24_000)} />
          </div>
        </details>
      )}
      {summarizing && (
        <Generating
          label={engine.engine === 'claude' ? 'Claude lit les commits et leurs diffs…' : 'L’IA locale lit les commits et leurs diffs…'}
          active={summarizing}
        />
      )}
      {adding && summary && (
        <div className="space-y-1 rounded-lg border border-line p-3 text-xs text-muted">
          <p className="flex items-center gap-1.5 font-medium text-fg">
            <Bot className="size-3.5 text-accent-ink" aria-hidden /> Proposition · {engineResultLabel(summary.engine, summary.model)} · à partir de{' '}
            {summary.commits.length} commit(s) — à relire
          </p>
          <p className="font-mono">
            {summary.commits.map((commit) => `${commit.shortHash}${commit.diff === 'full' ? '' : commit.diff === 'truncated' ? ' (diff tronqué)' : ' (sans diff)'}`).join(' · ')}
          </p>
          {summary.warnings.map((warning) => (
            <p key={warning} data-status="ON_HOLD">
              <span className="ds-ink">{warning}</span>
            </p>
          ))}
        </div>
      )}
      {adding && (
        <form onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-sunken p-3">
          <Field label="Nouvelle entrée (horodatée automatiquement)">
            <textarea
              className="ds-textarea"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Comment la tâche a été réalisée techniquement…"
              required
              autoFocus
            />
          </Field>
          <div className="flex items-end justify-between gap-3">
            <Field label="Heures passées (facultatif)">
              <input className="ds-input w-28" inputMode="decimal" value={spent} onChange={(event) => setSpent(event.target.value)} placeholder="4.5" />
            </Field>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAdding(false)
                  setSummary(null)
                }}
              >
                Annuler
              </Button>
              <Button size="sm" type="submit" variant="primary" busy={busy === 'append'} disabled={text.trim() === ''}>
                Ajouter au journal
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted">Les heures indiquées ici figurent dans l’en-tête de l’entrée ; utilisez « Saisir temps » pour les compter dans le réalisé.</p>
        </form>
      )}
      <MarkdownEditor
        key={`log-${item.id}`}
        value={item.implementationLog}
        empty="Le journal est vide. Ajoutez une entrée pour expliquer comment la tâche est réalisée."
        busy={busy === 'log'}
        onSave={(implementationLog) => run('log', () => workItemService.update(item.id, { implementationLog }), 'Journal enregistré')}
        extraActions={
          <>
            {!adding && (
              <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
                Ajouter une entrée
              </Button>
            )}
            <Button
              size="sm"
              icon={<Bot className="size-3.5" />}
              busy={summarizing}
              disabled={item.commits.length === 0}
              title={
                item.commits.length === 0
                  ? `Aucun commit lié : citer #${item.id} dans un message de commit puis analyser le dépôt`
                  : `Rédiger une entrée du journal à partir des git diff des commits liés (${engine.engine === 'claude' ? 'Claude' : 'IA locale'})`
              }
              onClick={summarize}
            >
              {summary && adding ? 'Régénérer le résumé' : 'Résumer mes commits'}
            </Button>
          </>
        }
      />
    </div>
  )
}

function GitSection({ item }: { item: WorkItemDetail }) {
  const { busy, run } = useAction()
  const projectId = item.projectId
  const empty = item.commits.length === 0 && item.pullRequests.length === 0

  return (
    <section className="space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <GitBranch className="size-4 text-st-closed" aria-hidden /> Commits Git &amp; GitHub associés
        </h3>
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw className="size-3.5" />}
          busy={busy === 'scan'}
          title="Analyser le dépôt Git local du projet"
          onClick={() =>
            run('scan', () => gitService.scan(projectId), undefined).then((result) => {
              if (result.ok) useApp.getState().notify('success', `Dépôt analysé : ${result.value.commitsCreated} nouveau(x) commit(s), ${result.value.linksCreated} lien(s).`)
            })
          }
        >
          Analyser
        </Button>
      </div>
      {empty && (
        <p className="text-sm text-muted">
          Aucun commit ni Pull Request ne cite <span className="font-mono">#{item.id}</span>. Les commits dont le message contient{' '}
          <span className="font-mono">feature #{item.id}</span>, <span className="font-mono">fix #{item.id}</span>… sont rattachés lors de l’analyse
          du dépôt.
        </p>
      )}
      <ul className="space-y-1">
        {item.commits.map((commit) => (
          <li key={commit.hash} className="flex gap-3 rounded-lg px-2 py-2 hover:bg-hover">
            <GitCommitHorizontal className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-sm font-semibold text-accent-ink" title={commit.hash}>
                  {commit.shortHash}
                </span>
                <span className="shrink-0 text-xs text-muted" title={dateTime(commit.committedAt)}>
                  {fromNow(commit.committedAt)}
                </span>
              </p>
              <p className="truncate text-sm" title={commit.message}>
                {commit.message.split('\n')[0]}
              </p>
              <p className="truncate text-xs text-muted">
                {commit.authorName}
                {commit.branch && (
                  <>
                    {' · '}
                    <span className="font-mono">{commit.branch}</span>
                  </>
                )}
              </p>
            </div>
          </li>
        ))}
        {item.pullRequests.map((pull) => (
          <li key={pull.number} className="flex gap-3 rounded-lg px-2 py-2 hover:bg-hover">
            <GitPullRequest className="mt-0.5 size-4 shrink-0 text-st-review" aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex items-start justify-between gap-2">
                <a href={pull.url} target="_blank" rel="noreferrer" className="min-w-0 text-sm hover:underline">
                  <span className="font-semibold">PR #{pull.number}</span> : « {pull.title} »
                  <ExternalLink className="ml-1 inline size-3 text-muted" aria-hidden />
                </a>
                <StatusBadge status={pull.status} />
              </p>
              <p className="truncate text-xs text-muted">
                <span className="font-mono">{pull.headBranch}</span> → <span className="font-mono">{pull.baseBranch}</span>
                {pull.authorLogin && ` · @${pull.authorLogin}`}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function DangerZone({ item }: { item: WorkItemDetail }) {
  const [confirming, setConfirming] = useState(false)
  const { busy, run } = useAction()
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 p-5">
      <span className="text-xs text-muted">
        Créé le {dateTime(item.createdAt)} · modifié {fromNow(item.updatedAt)}
      </span>
      {confirming ? (
        <span className="flex items-center gap-2">
          <span className="text-sm">Supprimer #{item.id} ?</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Non
          </Button>
          <Button
            size="sm"
            variant="danger"
            busy={busy === 'delete'}
            onClick={async () => {
              const result = await run('delete', () => workItemService.remove(item.id), `Élément #${item.id} supprimé`)
              if (result.ok) useApp.getState().openWorkItem(null)
            }}
          >
            Oui, supprimer
          </Button>
        </span>
      ) : (
        <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirming(true)}>
          Supprimer
        </Button>
      )}
    </section>
  )
}
