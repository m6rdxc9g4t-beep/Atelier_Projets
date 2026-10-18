// Maquette A : santé du budget, indicateurs, histogramme des 8 statuts (empilé par type), phases et jalons.
import { BarChart3, Flag } from 'lucide-react'
import { useState } from 'react'
import { HealthCard } from '../components/HealthCard.tsx'
import { Card, Eyebrow, ErrorNotice, ProgressBar, Spinner, StatusBadge, TypeChip } from '../components/ui.tsx'
import { days, longDate, percent } from '../lib/format.ts'
import { levelCode, STATUS_CODE, STATUS_LABEL, TYPE_LABEL, WORK_ITEM_TYPES } from '../lib/labels.ts'
import { useApi } from '../lib/use-api.ts'
import { reportService } from '../services/api.ts'
import type { Dashboard, Milestone, Project, ProjectTree } from '../services/types.ts'
import { useApp } from '../store/app.ts'

export function DashboardView({ project }: { project: Project }) {
  const hoursPerDay = useApp((state) => state.hoursPerDay) ?? undefined
  const dashboard = useApi(() => reportService.dashboard(project.id, { hoursPerDay }), [project.id, hoursPerDay])
  const tree = useApi(() => reportService.tree(project.id, { hoursPerDay }), [project.id, hoursPerDay])

  if (dashboard.error) return <ErrorNotice error={dashboard.error} onRetry={dashboard.reload} />
  if (!dashboard.data) return <Spinner />
  const data = dashboard.data

  return (
    <>
      <HealthCard dashboard={data} />
      <KpiRow dashboard={data} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <StatusHistogram dashboard={data} />
        <div className="space-y-5">
          {tree.data && <PhaseProgress tree={tree.data} />}
          {tree.data && <Milestones tree={tree.data} />}
          {tree.error && <ErrorNotice error={tree.error} onRetry={tree.reload} />}
        </div>
      </div>
    </>
  )
}

function KpiRow({ dashboard }: { dashboard: Dashboard }) {
  const tiles = [
    { label: 'Éléments', value: String(dashboard.workItems.total), detail: 'Features, Tasks et Bugs' },
    {
      label: 'Terminés ou résolus',
      value: String(dashboard.workItems.done),
      detail: `${percent(dashboard.workItems.donePercent)} des éléments`,
    },
    { label: 'Charge estimée', value: days(dashboard.progress.planned), detail: 'Somme des estimations (hors rejetés)' },
    { label: 'Valeur acquise', value: days(dashboard.progress.earned), detail: 'Estimations × avancement' },
  ]
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label} className="p-4">
          <p className="text-sm text-muted">{tile.label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{tile.value}</p>
          <p className="mt-1 text-xs text-muted">{tile.detail}</p>
        </Card>
      ))}
    </div>
  )
}

/** Graduation « ronde » de l'axe : 1, 2, 5 × 10ⁿ, au plus 5 intervalles. */
function axisTicks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / 5
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ?? magnitude * 10
  const stepInt = Math.max(1, Math.round(step))
  const top = Math.ceil(max / stepInt) * stepInt
  return Array.from({ length: top / stepInt + 1 }, (_, index) => index * stepInt)
}

function StatusHistogram({ dashboard }: { dashboard: Dashboard }) {
  const [hovered, setHovered] = useState<string | null>(null)
  const max = Math.max(0, ...dashboard.histogram.map((column) => column.total))
  const ticks = axisTicks(max)
  const top = ticks[ticks.length - 1] ?? 1

  return (
    <Card className="p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>
          <span className="inline-flex items-center gap-2">
            <BarChart3 className="size-4" aria-hidden /> Histogramme des éléments par statut
          </span>
        </Eyebrow>
        <ul className="flex flex-wrap items-center gap-4 text-sm" aria-label="Légende">
          {WORK_ITEM_TYPES.map((type) => (
            <li key={type} className="flex items-center gap-2">
              <TypeChip type={type} />
              {TYPE_LABEL[type]}
            </li>
          ))}
        </ul>
      </div>

      {max === 0 ? (
        <p className="py-16 text-center text-muted">Aucun élément dans ce projet.</p>
      ) : (
        <div className="flex gap-3 pt-3" aria-hidden>
          <div className="relative w-6 shrink-0 text-right text-xs tabular-nums text-muted" style={{ height: 240 }}>
            {ticks.map((tick) => (
              <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${(tick / top) * 100}%` }}>
                {tick}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative" style={{ height: 240 }}>
              {ticks.map((tick) => (
                <div key={tick} className="absolute inset-x-0 border-t border-grid" style={{ bottom: `${(tick / top) * 100}%` }} />
              ))}
              <div className="absolute inset-0 grid grid-cols-8">
                {dashboard.histogram.map((column) => (
                  <div
                    key={column.status}
                    className={`relative flex flex-col items-center justify-end rounded-md transition-colors ${hovered === column.status ? 'bg-hover' : ''}`}
                    onMouseEnter={() => setHovered(column.status)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    {column.total > 0 && <span className="mb-1 text-xs font-semibold tabular-nums">{column.total}</span>}
                    <div className="flex w-[min(2.75rem,60%)] flex-col-reverse gap-[2px]" style={{ height: `${(column.total / top) * 100}%` }}>
                      {WORK_ITEM_TYPES.map((type) =>
                        column.byType[type] > 0 ? (
                          <div
                            key={type}
                            data-type={type}
                            className="bg-kind last:rounded-t-[4px]"
                            style={{ flexGrow: column.byType[type], flexBasis: 0 }}
                          />
                        ) : null,
                      )}
                    </div>
                    {hovered === column.status && column.total > 0 && (
                      <div className="ds-card pointer-events-none absolute bottom-full z-10 mb-2 w-44 p-3 text-xs shadow-overlay">
                        <p className="mb-2 font-semibold">
                          {STATUS_LABEL[column.status]} · {column.total}
                        </p>
                        {WORK_ITEM_TYPES.map((type) => (
                          <p key={type} className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2">
                              <TypeChip type={type} /> {TYPE_LABEL[type]}
                            </span>
                            <span className="tabular-nums">{column.byType[type]}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-8 border-t border-line pt-3">
              {dashboard.histogram.map((column) => (
                <div key={column.status} className="flex min-w-0 flex-col items-center gap-1 px-0.5 text-center" data-status={column.status}>
                  <span className="ds-dot" />
                  <span className="truncate text-[11px] font-semibold tracking-wide">{STATUS_CODE[column.status]}</span>
                  <span className="truncate text-[11px] text-muted">{STATUS_LABEL[column.status]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <table className="sr-only">
        <caption>Éléments par statut et par type</caption>
        <thead>
          <tr>
            <th>Statut</th>
            {WORK_ITEM_TYPES.map((type) => (
              <th key={type}>{TYPE_LABEL[type]}</th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {dashboard.histogram.map((column) => (
            <tr key={column.status}>
              <th>{STATUS_LABEL[column.status]}</th>
              {WORK_ITEM_TYPES.map((type) => (
                <td key={type}>{column.byType[type]}</td>
              ))}
              <td>{column.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function PhaseProgress({ tree }: { tree: ProjectTree }) {
  return (
    <Card className="p-5">
      <Eyebrow className="mb-4">Avancement par phase</Eyebrow>
      {tree.phases.length === 0 ? (
        <p className="text-muted">Aucune phase.</p>
      ) : (
        <ul className="space-y-4">
          {tree.phases.map((phase) => (
            <li key={phase.id} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <TypeChip type="PHASE" />
                  <span className="truncate">
                    <span className="ds-ink font-semibold" data-type="PHASE">
                      {levelCode('PHASE', phase.code)}
                    </span>{' '}
                    : {phase.title}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-muted">{percent(phase.aggregate.progress)}</span>
              </div>
              <ProgressBar value={phase.aggregate.progress} tone="progress" label={`Avancement de ${levelCode('PHASE', phase.code)}`} />
              <div className="flex items-center justify-between text-xs text-muted">
                <span>
                  {days(phase.aggregate.spent)} réalisés / {days(phase.aggregate.estimate)} estimés
                </span>
                {phase.aggregate.workItems > 0 && <StatusBadge status={phase.aggregate.status} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Milestones({ tree }: { tree: ProjectTree }) {
  const milestones: Milestone[] = [...tree.milestones, ...tree.phases.flatMap((phase) => phase.milestones)].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id - b.id,
  )
  const openDialog = useApp((state) => state.openDialog)
  return (
    <Card className="p-5">
      <Eyebrow className="mb-4">
        <span className="inline-flex items-center gap-2">
          <Flag className="size-4" aria-hidden /> Jalons
        </span>
      </Eyebrow>
      {milestones.length === 0 ? (
        <p className="text-muted">Aucun jalon.</p>
      ) : (
        <ul className="space-y-1">
          {milestones.map((milestone) => (
            <li key={milestone.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-hover"
                onClick={() => openDialog({ kind: 'editMilestone', id: milestone.id })}
              >
                <span className="ds-diamond" data-reached={milestone.reached} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{milestone.title}</span>
                <span className="shrink-0 text-xs text-muted">{longDate(milestone.date)}</span>
                <span className="w-16 shrink-0 text-right text-xs" data-status={milestone.reached ? 'CLOSED' : 'OPEN'}>
                  <span className="ds-ink">{milestone.reached ? 'Atteint ✅' : 'À venir'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
