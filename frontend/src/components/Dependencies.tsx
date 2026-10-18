// Fiche élément : dépendances « fin → début » (ce qu'il attend, ce qu'il bloque), marge et conflits
// calculés par le backend ; ajout d'un prédécesseur par recherche (#ID ou titre).
import { ArrowRight, Link2, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useAction } from '../lib/use-action.ts'
import { useApi } from '../lib/use-api.ts'
import { scheduleService, workItemService } from '../services/api.ts'
import type { DependencyRef, WorkItemDetail } from '../services/types.ts'
import { useApp } from '../store/app.ts'
import { STATUS_LABEL } from '../lib/labels.ts'
import { Button } from './ui.tsx'

function SlackBadge({ slackDays }: { slackDays: number | null }) {
  if (slackDays === null) return <span className="text-xs text-muted">non planifié</span>
  if (slackDays < 0) {
    return (
      <span className="ds-badge shrink-0" data-status="REJECTED" title={`Commence ${-slackDays} j avant la fin de son prédécesseur`}>
        conflit {-slackDays} j
      </span>
    )
  }
  return (
    <span className="ds-badge shrink-0" data-status={slackDays === 0 ? 'BLOCKED' : 'OPEN'} title="Jours libres entre la fin du prédécesseur et le début du successeur">
      {slackDays === 0 ? 'enchaîné' : `marge ${slackDays} j`}
    </span>
  )
}

function RefRow({ dependency, onRemove, busy }: { dependency: DependencyRef; onRemove: () => void; busy: boolean }) {
  const openWorkItem = useApp((state) => state.openWorkItem)
  return (
    <li className="flex items-center gap-2 px-3 py-2 text-sm">
      <span className="ds-dot shrink-0" data-status={dependency.status} title={STATUS_LABEL[dependency.status]} aria-label={STATUS_LABEL[dependency.status]} />
      <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => openWorkItem(dependency.id)} title={dependency.title}>
        <span className="ds-ink font-semibold" data-type={dependency.type}>
          #{dependency.id}
        </span>{' '}
        {dependency.title}
      </button>
      <SlackBadge slackDays={dependency.slackDays} />
      <Button variant="ghost" size="sm" icon={<X className="size-3.5" />} aria-label={`Retirer la dépendance avec #${dependency.id}`} busy={busy} onClick={onRemove} />
    </li>
  )
}

export function DependenciesSection({ item }: { item: WorkItemDetail }) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const { busy, run } = useAction()
  const linked = new Set([item.id, ...item.predecessors.map((ref) => ref.id), ...item.successors.map((ref) => ref.id)])
  const candidates = useApi(
    adding ? () => workItemService.list(item.projectId, query.trim() ? { q: query.trim() } : {}) : null,
    [item.projectId, adding, query.trim()],
  )
  const options = (candidates.data ?? []).filter((candidate) => !linked.has(candidate.id)).slice(0, 8)

  const add = async (predecessorId: number) => {
    const result = await run(
      'add',
      () => scheduleService.addDependency(item.id, predecessorId),
      `#${item.id} commencera après la fin de #${predecessorId}`,
    )
    if (result.ok) {
      setAdding(false)
      setQuery('')
    }
  }

  return (
    <section className="space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <Link2 className="size-4 text-muted" aria-hidden /> Dépendances
        </h3>
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding((value) => !value)} aria-expanded={adding}>
          Prédécesseur
        </Button>
      </div>

      {adding && (
        <div className="space-y-2 rounded-lg border border-line bg-sunken p-3">
          <input
            className="ds-input"
            placeholder="Rechercher un élément (#ID ou titre)…"
            aria-label="Rechercher le prédécesseur"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
          <ul className="max-h-56 divide-y divide-line overflow-auto rounded-md border border-line bg-surface" aria-label="Éléments proposés">
            {options.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover disabled:opacity-60"
                  disabled={busy === 'add'}
                  onClick={() => void add(candidate.id)}
                >
                  <span className="ds-ink shrink-0 font-semibold" data-type={candidate.type}>
                    #{candidate.id}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted" aria-hidden />
                  <span className="shrink-0 text-xs text-muted">#{item.id}</span>
                </button>
              </li>
            ))}
            {candidates.data && options.length === 0 && <li className="px-3 py-2 text-sm text-muted">Aucun élément à proposer.</li>}
          </ul>
          <p className="text-xs text-muted">Le prédécesseur doit être terminé avant le début de #{item.id}. Dans le Gantt, on peut aussi tirer le rond au bout d’une barre jusqu’à une autre.</p>
        </div>
      )}

      {item.predecessors.length === 0 && item.successors.length === 0 && !adding && (
        <p className="text-sm text-muted">Aucune dépendance.</p>
      )}
      {item.predecessors.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Attend la fin de</h4>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {item.predecessors.map((dependency) => (
              <RefRow
                key={dependency.id}
                dependency={dependency}
                busy={busy === `remove-${dependency.id}`}
                onRemove={() => run(`remove-${dependency.id}`, () => scheduleService.removeDependency(item.id, dependency.id), 'Dépendance retirée')}
              />
            ))}
          </ul>
        </div>
      )}
      {item.successors.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Bloque</h4>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {item.successors.map((dependency) => (
              <RefRow
                key={dependency.id}
                dependency={dependency}
                busy={busy === `remove-${dependency.id}`}
                onRemove={() => run(`remove-${dependency.id}`, () => scheduleService.removeDependency(dependency.id, item.id), 'Dépendance retirée')}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
