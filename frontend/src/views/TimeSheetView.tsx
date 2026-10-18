// Maquette D : tableau des temps (budget, réalisé, bilan par élément), filtres epic / type / statut,
// conversion « 1 jour = X heures » demandée au backend.
import { Clock3 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Card, Eyebrow, ErrorNotice, Spinner, StatusBadge, TypeChip } from '../components/ui.tsx'
import { days, daysAndHours, percent, signedDays } from '../lib/format.ts'
import { levelCode, STATUS_LABEL, STATUSES, TYPE_LABEL, WORK_ITEM_TYPES } from '../lib/labels.ts'
import { useApi } from '../lib/use-api.ts'
import { reportService } from '../services/api.ts'
import type { Balance, Project, TimesheetRow, WorkItemStatus, WorkItemType } from '../services/types.ts'
import { useAppState } from '../store/app.ts'

const HOURS_PER_DAY_CHOICES = [6, 7, 7.5, 8, 9, 10]

export function TimeSheetView({ project }: { project: Project }) {
  const { hoursPerDay, setHoursPerDay, openWorkItem, selected } = useAppState((state) => ({
    hoursPerDay: state.hoursPerDay,
    setHoursPerDay: state.setHoursPerDay,
    openWorkItem: state.openWorkItem,
    selected: state.selectedWorkItemId,
  }))
  const [epicId, setEpicId] = useState<number | null>(null)
  const [types, setTypes] = useState<WorkItemType[]>([])
  const [status, setStatus] = useState<WorkItemStatus | null>(null)
  const effectiveHours = hoursPerDay ?? project.hoursPerDay

  const tree = useApi(() => reportService.tree(project.id), [project.id])
  const sheet = useApi(
    () =>
      reportService.timesheet(project.id, {
        hoursPerDay: hoursPerDay ?? undefined,
        epicId: epicId ?? undefined,
        type: types.length > 0 ? types : undefined,
        status: status ? [status] : undefined,
      }),
    [project.id, hoursPerDay, epicId, types.join(','), status],
  )

  const epics = useMemo(
    () => tree.data?.phases.flatMap((phase) => phase.epics.map((epic) => ({ id: epic.id, label: `${levelCode('EPIC', epic.code)} : ${epic.title}` }))) ?? [],
    [tree.data],
  )
  const hourChoices = [...new Set([...HOURS_PER_DAY_CHOICES, project.hoursPerDay])].sort((a, b) => a - b)

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <Eyebrow>
          <span className="inline-flex items-center gap-2">
            <Clock3 className="size-4" aria-hidden /> Tableau des temps (timesheet)
          </span>
        </Eyebrow>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="ds-select w-auto max-w-64"
            aria-label="Filtrer par epic"
            value={epicId ?? ''}
            onChange={(event) => setEpicId(event.target.value === '' ? null : Number(event.target.value))}
          >
            <option value="">Tous les Epics</option>
            {epics.map((epic) => (
              <option key={epic.id} value={epic.id}>
                {epic.label}
              </option>
            ))}
          </select>
          <select
            className="ds-select w-auto"
            aria-label="Filtrer par statut"
            value={status ?? ''}
            onChange={(event) => setStatus(event.target.value === '' ? null : (event.target.value as WorkItemStatus))}
          >
            <option value="">Tous les statuts</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABEL[value]}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1 rounded-lg border border-line bg-sunken p-0.5" role="group" aria-label="Filtrer par type">
            {WORK_ITEM_TYPES.map((type) => {
              const active = types.includes(type)
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={active}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm ${active ? 'bg-elevated text-fg' : 'text-muted hover:text-fg'}`}
                  onClick={() => setTypes((current) => (active ? current.filter((value) => value !== type) : [...current, type]))}
                >
                  <TypeChip type={type} />
                  {TYPE_LABEL[type]}
                </button>
              )
            })}
          </div>
          <select
            className="ds-select w-auto"
            aria-label="Conversion jours / heures"
            value={effectiveHours}
            onChange={(event) => {
              const value = Number(event.target.value)
              setHoursPerDay(value === project.hoursPerDay ? null : value)
            }}
          >
            {hourChoices.map((value) => (
              <option key={value} value={value}>
                1 Jour = {value} Heures{value === project.hoursPerDay ? ' (projet)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {sheet.error && (
        <div className="p-4">
          <ErrorNotice error={sheet.error} onRetry={sheet.reload} />
        </div>
      )}
      {!sheet.data && !sheet.error && (
        <div className="p-5">
          <Spinner />
        </div>
      )}
      {sheet.data && (
        <div className="overflow-x-auto">
          <table className="ds-table min-w-[50rem]">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Élément &amp; type</th>
                <th scope="col">Statut</th>
                <th scope="col" className="ds-num">
                  Budget (j)
                </th>
                <th scope="col" className="ds-num">
                  Réalisé
                </th>
                <th scope="col" className="ds-num">
                  Bilan
                </th>
              </tr>
            </thead>
            <tbody>
              {sheet.data.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-muted">
                    Aucun élément ne correspond aux filtres.
                  </td>
                </tr>
              )}
              {sheet.data.rows.map((row) => (
                <TimesheetLine key={row.id} row={row} selected={row.id === selected} onOpen={() => openWorkItem(row.id)} />
              ))}
            </tbody>
            {sheet.data.rows.length > 0 && (
              <tfoot>
                <tr>
                  <td>TOTAL</td>
                  <td>
                    {sheet.data.totals.count} élément{sheet.data.totals.count > 1 ? 's' : ''} affiché{sheet.data.totals.count > 1 ? 's' : ''}
                  </td>
                  <td>{percent(sheet.data.totals.donePercent)} Terminé/Résolu</td>
                  <td className="ds-num">{days(sheet.data.totals.estimate, 2)}</td>
                  <td className="ds-num">{daysAndHours(sheet.data.totals.spent)}</td>
                  <td className="ds-num">
                    <BalanceCell balance={sheet.data.totals.balance} />
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </Card>
  )
}

function TimesheetLine({ row, selected, onOpen }: { row: TimesheetRow; selected: boolean; onOpen: () => void }) {
  return (
    <tr
      className={`cursor-pointer ${selected ? 'bg-accent-soft' : ''}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      tabIndex={0}
      aria-selected={selected}
    >
      <td className="font-mono text-sm">
        <span className="ds-ink font-semibold" data-type={row.type}>
          #{row.id}
        </span>
      </td>
      <td>
        <span className="flex min-w-0 items-center gap-2">
          <TypeChip type={row.type} />
          <span className="truncate">
            <span className="text-muted">{TYPE_LABEL[row.type]}:</span> {row.title}
          </span>
        </span>
        <span className="mt-0.5 block truncate pl-6 text-xs text-muted">
          {levelCode('EPIC', row.path.epic.code)} › {levelCode('STORY', row.path.story.code)} : {row.path.story.title}
        </span>
      </td>
      <td>
        <StatusBadge status={row.status} />
      </td>
      <td className="ds-num">{row.estimate ? days(row.estimate, 2) : '—'}</td>
      <td className="ds-num">{daysAndHours(row.spent)}</td>
      <td className="ds-num">{row.balance ? <BalanceCell balance={row.balance} /> : <span className="text-muted">—</span>}</td>
    </tr>
  )
}

const BALANCE_HINT: Record<Balance['kind'], string> = {
  UNDER: 'Sous le budget',
  ON_BUDGET: 'Dans le budget',
  OVER: 'Dépassement',
  REMAINING: 'Reste à consommer',
}

function BalanceCell({ balance }: { balance: Balance }) {
  const text = balance.kind === 'REMAINING' ? `${days(balance.delta, 2)} rest.` : signedDays(balance.delta)
  return (
    <span className="ds-badge tabular-nums" data-balance={balance.kind} title={BALANCE_HINT[balance.kind]}>
      {text}
    </span>
  )
}
