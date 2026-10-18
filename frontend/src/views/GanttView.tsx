// Maquette B : santé du projet puis diagramme de Gantt (Phases > Epics > Stories > Éléments, jalons ◆).
// Le backend fournit agrégats, avancements et plages de dates ; ici, seulement la mise en page du calendrier.
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Flag, Pencil, Plus, Sparkles } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { HealthCard } from '../components/HealthCard.tsx'
import { Button, Card, Eyebrow, ErrorNotice, Spinner, TypeChip } from '../components/ui.tsx'
import { days, parseDate, percent, shortDate, today } from '../lib/format.ts'
import { levelCode, STATUS_LABEL, TYPE_LABEL } from '../lib/labels.ts'
import { useApi } from '../lib/use-api.ts'
import { reportService } from '../services/api.ts'
import type { Aggregate, DateSpan, Milestone, Project, ProjectTree, TreeWorkItem } from '../services/types.ts'
import { useApp, useAppState, type DialogRequest } from '../store/app.ts'

type Zoom = 'day' | 'week' | 'month'
const PX_PER_DAY: Record<Zoom, number> = { day: 34, week: 18, month: 6 }
const ZOOM_LABEL: Record<Zoom, string> = { day: 'Jour', week: 'Semaine', month: 'Mois' }
const ROW_HEIGHT = 44
const DAY_MS = 86_400_000

export function GanttView({ project }: { project: Project }) {
  const hoursPerDay = useApp((state) => state.hoursPerDay) ?? undefined
  const dashboard = useApi(() => reportService.dashboard(project.id, { hoursPerDay }), [project.id, hoursPerDay])
  const tree = useApi(() => reportService.tree(project.id, { hoursPerDay }), [project.id, hoursPerDay])

  return (
    <>
      {dashboard.data && <HealthCard dashboard={dashboard.data} />}
      {dashboard.error && <ErrorNotice error={dashboard.error} onRetry={dashboard.reload} />}
      {tree.error && <ErrorNotice error={tree.error} onRetry={tree.reload} />}
      {!tree.data && !tree.error && <Spinner />}
      {tree.data && <Gantt tree={tree.data} />}
    </>
  )
}

// --- Lignes du diagramme ------------------------------------------------------------------------

type RowKind = 'PHASE' | 'EPIC' | 'STORY' | 'ITEM' | 'MILESTONE'

interface Row {
  key: string
  kind: RowKind
  level: number
  code: string
  title: string
  span: DateSpan | null
  aggregate?: Aggregate
  item?: TreeWorkItem
  milestone?: Milestone
  collapsible: boolean
  add?: { label: string; dialog: DialogRequest }
  edit?: DialogRequest
  /** ✨ Découpage de la story par l'IA locale. */
  breakdown?: DialogRequest
}

function buildRows(tree: ProjectTree, collapsed: ReadonlySet<string>): Row[] {
  const rows: Row[] = []
  const milestoneRow = (milestone: Milestone, level: number): Row => ({
    key: `milestone-${milestone.id}`,
    kind: 'MILESTONE',
    level,
    code: 'MILESTONE',
    title: milestone.title,
    span: { start: milestone.date, end: milestone.date },
    milestone,
    collapsible: false,
    edit: { kind: 'editMilestone', id: milestone.id },
  })

  for (const phase of tree.phases) {
    const phaseKey = `phase-${phase.id}`
    rows.push({
      key: phaseKey,
      kind: 'PHASE',
      level: 0,
      code: levelCode('PHASE', phase.code),
      title: phase.title,
      span: phase.span,
      aggregate: phase.aggregate,
      collapsible: true,
      add: { label: 'Ajouter un epic', dialog: { kind: 'epic', phaseId: phase.id } },
      edit: { kind: 'editContainer', level: 'phase', id: phase.id, title: phase.title, startDate: phase.startDate, dueDate: phase.dueDate },
    })
    if (collapsed.has(phaseKey)) continue
    for (const epic of phase.epics) {
      const epicKey = `epic-${epic.id}`
      rows.push({
        key: epicKey,
        kind: 'EPIC',
        level: 1,
        code: levelCode('EPIC', epic.code),
        title: epic.title,
        span: epic.span,
        aggregate: epic.aggregate,
        collapsible: true,
        add: { label: 'Ajouter une story', dialog: { kind: 'story', epicId: epic.id } },
        edit: { kind: 'editContainer', level: 'epic', id: epic.id, title: epic.title, startDate: epic.startDate, dueDate: epic.dueDate },
      })
      if (collapsed.has(epicKey)) continue
      for (const story of epic.stories) {
        const storyKey = `story-${story.id}`
        rows.push({
          key: storyKey,
          kind: 'STORY',
          level: 2,
          code: levelCode('STORY', story.code),
          title: story.title,
          span: story.span,
          aggregate: story.aggregate,
          collapsible: story.workItems.length > 0,
          add: { label: 'Ajouter un élément', dialog: { kind: 'workItem', storyId: story.id } },
          breakdown: { kind: 'breakdown', storyId: story.id, label: `${levelCode('STORY', story.code)} : ${story.title}` },
          edit: { kind: 'editContainer', level: 'story', id: story.id, title: story.title, startDate: story.startDate, dueDate: story.dueDate },
        })
        if (collapsed.has(storyKey)) continue
        for (const item of story.workItems) {
          rows.push({ key: `item-${item.id}`, kind: 'ITEM', level: 3, code: `#${item.id}`, title: item.title, span: item.span, item, collapsible: false })
        }
      }
    }
    for (const milestone of phase.milestones) rows.push(milestoneRow(milestone, 1))
  }
  for (const milestone of tree.milestones) rows.push(milestoneRow(milestone, 0))
  return rows
}

// --- Calendrier -----------------------------------------------------------------------------------

interface Calendar {
  start: Date
  totalDays: number
  ppd: number
  months: { label: string; offset: number; width: number }[]
  ticks: { label: string; offset: number; width: number }[]
  todayOffset: number | null
}

const monthFormat = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const monthShort = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' })

function addDays(date: Date, amount: number): Date {
  return new Date(date.getTime() + amount * DAY_MS)
}

function dayIndex(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS)
}

function buildCalendar(tree: ProjectTree, zoom: Zoom): Calendar {
  const now = parseDate(today())
  const dates: Date[] = []
  if (tree.range) dates.push(parseDate(tree.range.start), parseDate(tree.range.end))
  for (const milestone of [...tree.milestones, ...tree.phases.flatMap((phase) => phase.milestones)]) dates.push(parseDate(milestone.date))
  if (dates.length === 0) dates.push(now)
  let min = new Date(Math.min(...dates.map((date) => date.getTime())))
  let max = new Date(Math.max(...dates.map((date) => date.getTime())))
  // La ligne « aujourd'hui » reste visible si le projet est proche.
  if (dayIndex(max, now) <= 45 && dayIndex(now, min) <= 45) {
    min = new Date(Math.min(min.getTime(), now.getTime()))
    max = new Date(Math.max(max.getTime(), now.getTime()))
  }
  // Du lundi précédent (avec une marge) au dimanche suivant (marge pour les libellés à droite des barres).
  const padded = addDays(min, -3)
  const start = addDays(padded, -((padded.getUTCDay() + 6) % 7))
  const paddedEnd = addDays(max, zoom === 'month' ? 35 : 17)
  const end = addDays(paddedEnd, (7 - paddedEnd.getUTCDay()) % 7)
  const totalDays = dayIndex(start, end) + 1
  const ppd = PX_PER_DAY[zoom]

  const months: Calendar['months'] = []
  for (let cursor = start; cursor <= end; ) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
    const last = next > end ? addDays(end, 1) : next
    months.push({ label: monthFormat.format(cursor), offset: dayIndex(start, cursor) * ppd, width: dayIndex(cursor, last) * ppd })
    cursor = last
  }

  const ticks: Calendar['ticks'] = []
  if (zoom === 'day') {
    for (let index = 0; index < totalDays; index += 1) {
      const date = addDays(start, index)
      ticks.push({ label: String(date.getUTCDate()), offset: index * ppd, width: ppd })
    }
  } else {
    for (let index = 0; index < totalDays; index += 7) {
      const monday = addDays(start, index)
      const label =
        zoom === 'week'
          ? `${monthShort.format(monday).replace('.', '').toUpperCase()} S${Math.ceil(monday.getUTCDate() / 7)}`
          : `S${Math.ceil(monday.getUTCDate() / 7)}`
      ticks.push({ label, offset: index * ppd, width: 7 * ppd })
    }
  }

  const todayIndex = dayIndex(start, now)
  return {
    start,
    totalDays,
    ppd,
    months,
    ticks,
    todayOffset: todayIndex >= 0 && todayIndex < totalDays ? todayIndex * ppd + ppd / 2 : null,
  }
}

// --- Composant ------------------------------------------------------------------------------------

function Gantt({ tree }: { tree: ProjectTree }) {
  const [zoom, setZoom] = useState<Zoom>('week')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const openDialog = useApp((state) => state.openDialog)
  const rows = useMemo(() => buildRows(tree, collapsed), [tree, collapsed])
  const calendar = useMemo(() => buildCalendar(tree, zoom), [tree, zoom])
  const scroller = useRef<HTMLDivElement>(null)
  const width = calendar.totalDays * calendar.ppd

  const containerKeys = useMemo(
    () => [
      ...tree.phases.map((phase) => `phase-${phase.id}`),
      ...tree.phases.flatMap((phase) => phase.epics.map((epic) => `epic-${epic.id}`)),
      ...tree.phases.flatMap((phase) => phase.epics.flatMap((epic) => epic.stories.map((story) => `story-${story.id}`))),
    ],
    [tree],
  )
  const allCollapsed = collapsed.size > 0

  // Ouvre le calendrier sur la semaine en cours (ou le début du projet) à l'affichage d'un projet ou
  // d'un nouveau zoom — pas après chaque modification, pour ne pas perdre la position de lecture.
  const calendarRef = useRef(calendar)
  calendarRef.current = calendar
  const hasRows = rows.length > 0
  useLayoutEffect(() => {
    const element = scroller.current
    const { todayOffset, ppd } = calendarRef.current
    if (element) element.scrollLeft = todayOffset === null ? 0 : Math.max(0, todayOffset - 3 * 7 * ppd)
  }, [tree.project.id, zoom, hasRows])

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <Card className="gantt-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <Eyebrow>Diagramme de Gantt &amp; jalons</Eyebrow>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted">
            Zoom
            <select className="ds-select w-auto min-w-28" value={zoom} onChange={(event) => setZoom(event.target.value as Zoom)}>
              {(Object.keys(ZOOM_LABEL) as Zoom[]).map((value) => (
                <option key={value} value={value}>
                  {ZOOM_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            icon={allCollapsed ? <ChevronsUpDown className="size-4" /> : <ChevronsDownUp className="size-4" />}
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(containerKeys.filter((key) => key.startsWith('story-'))))}
          >
            {allCollapsed ? 'Tout déplier' : 'Replier les stories'}
          </Button>
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => openDialog({ kind: 'phase' })}>
            Phase
          </Button>
          <Button size="sm" variant="primary" icon={<Flag className="size-4" />} onClick={() => openDialog({ kind: 'milestone' })}>
            Jalon
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-6 py-14 text-center text-muted">
          <p className="mb-4">Aucune phase : commencez par découper le projet.</p>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openDialog({ kind: 'phase' })}>
            Créer une phase
          </Button>
        </div>
      ) : (
        <div ref={scroller} className="gantt relative max-h-[calc(100vh-15rem)] min-h-64 overflow-auto" role="grid" aria-label="Diagramme de Gantt">
          <div className="relative" style={{ width: `calc(var(--gantt-left) + ${width}px)` }}>
            {/* En-tête : mois puis semaines (ou jours) */}
            <div className="sticky top-0 z-20 flex border-b border-line bg-surface" role="row">
              <div
                className="sticky left-0 z-10 flex w-[var(--gantt-left)] shrink-0 items-end justify-between border-r border-line bg-surface px-4 pb-2 text-sm font-semibold text-muted"
                role="columnheader"
              >
                <span>Hiérarchie</span>
                <span className="text-xs font-semibold uppercase tracking-wide">Budget</span>
              </div>
              <div className="relative h-16 shrink-0" style={{ width }} role="columnheader" aria-label="Calendrier">
                {calendar.months.map((month) => (
                  <div
                    key={month.offset}
                    className="absolute top-0 flex h-8 items-center justify-center truncate border-l border-line px-2 text-xs font-semibold uppercase tracking-wide text-muted"
                    style={{ left: month.offset, width: month.width }}
                  >
                    {month.width > 60 ? month.label : ''}
                  </div>
                ))}
                {calendar.ticks.map((tick) => (
                  <div
                    key={tick.offset}
                    className="absolute top-8 flex h-8 items-center justify-center border-l border-t border-line text-xs tabular-nums text-muted"
                    style={{ left: tick.offset, width: tick.width }}
                  >
                    {tick.label}
                  </div>
                ))}
                {calendar.todayOffset !== null && (
                  <div
                    className="absolute bottom-0 size-0 -translate-x-1/2 border-x-[6px] border-t-[7px] border-x-transparent border-t-accent"
                    style={{ left: calendar.todayOffset }}
                    title="Aujourd’hui"
                  />
                )}
              </div>
            </div>

            {calendar.todayOffset !== null && (
              <div
                className="pointer-events-none absolute bottom-0 top-16 z-0 w-0.5 bg-accent opacity-70"
                style={{ left: `calc(var(--gantt-left) + ${calendar.todayOffset - 1}px)` }}
                aria-hidden
              />
            )}

            {rows.map((row) => (
              <GanttRow
                key={row.key}
                row={row}
                calendar={calendar}
                width={width}
                collapsed={collapsed.has(row.key)}
                onToggle={() => toggle(row.key)}
              />
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

function GanttRow({
  row,
  calendar,
  width,
  collapsed,
  onToggle,
}: {
  row: Row
  calendar: Calendar
  width: number
  collapsed: boolean
  onToggle: () => void
}) {
  const { openWorkItem, openDialog, selected } = useAppState((state) => ({
    openWorkItem: state.openWorkItem,
    openDialog: state.openDialog,
    selected: state.selectedWorkItemId,
  }))
  const isItem = row.kind === 'ITEM' && row.item
  const isSelected = isItem && selected === row.item?.id
  const kindAttr = row.item ? row.item.type : row.kind
  const container = row.kind === 'PHASE' || row.kind === 'EPIC'

  const open = () => {
    if (row.item) openWorkItem(row.item.id)
    else if (row.edit) openDialog(row.edit)
  }

  const estimate = row.item ? row.item.estimate : row.aggregate?.estimate
  const gridStyle = {
    width,
    height: ROW_HEIGHT,
    backgroundImage: `linear-gradient(to right, var(--grid-line) 1px, transparent 1px)`,
    backgroundSize: `${7 * calendar.ppd}px 100%`,
  }

  return (
    <div
      role="row"
      aria-selected={isSelected || undefined}
      className={`group flex border-b border-line ${container ? 'bg-sunken' : ''} ${isSelected ? 'bg-accent-soft' : 'hover:bg-hover'}`}
    >
      <div
        role="gridcell"
        className={`sticky left-0 z-10 flex w-[var(--gantt-left)] shrink-0 items-center gap-2 border-r border-line pr-3 ${
          isSelected ? 'bg-elevated' : container ? 'bg-sunken group-hover:bg-hover' : 'bg-surface group-hover:bg-hover'
        }`}
        style={{ paddingLeft: 12 + row.level * 18 }}
      >
        {row.collapsible ? (
          <button
            type="button"
            className="grid size-5 shrink-0 place-items-center rounded text-muted hover:text-fg"
            aria-label={collapsed ? `Déplier ${row.code}` : `Replier ${row.code}`}
            aria-expanded={!collapsed}
            onClick={onToggle}
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        {row.kind === 'MILESTONE' ? <span className="ds-diamond mx-0.5" data-reached={row.milestone?.reached} aria-hidden /> : <TypeChip type={kindAttr as 'PHASE'} />}
        <button
          type="button"
          onClick={open}
          className={`min-w-0 flex-1 truncate text-left ${row.kind === 'PHASE' ? 'font-semibold' : ''}`}
          title={`${row.code} : ${row.title}`}
        >
          {row.item ? (
            <>
              <span className="ds-ink font-semibold" data-type={row.item.type}>
                {row.code}
              </span>{' '}
              <span className="text-muted">{TYPE_LABEL[row.item.type]}:</span> {row.title}
            </>
          ) : (
            <>
              <span className="ds-ink font-semibold uppercase" data-type={row.kind}>
                {row.code}
              </span>{' '}
              : {row.title}
            </>
          )}
        </button>
        <span className="absolute right-16 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-line bg-surface p-0.5 shadow-card group-focus-within:flex group-hover:flex">
          {row.breakdown && (
            <RowAction label="Générer les sous-tâches (IA locale)" onClick={() => row.breakdown && openDialog(row.breakdown)}>
              <Sparkles className="size-3.5" />
            </RowAction>
          )}
          {row.add && (
            <RowAction label={row.add.label} onClick={() => row.add && openDialog(row.add.dialog)}>
              <Plus className="size-3.5" />
            </RowAction>
          )}
          {row.edit && (
            <RowAction label={`Modifier ${row.code}`} onClick={() => row.edit && openDialog(row.edit)}>
              <Pencil className="size-3.5" />
            </RowAction>
          )}
        </span>
        <span className="w-14 shrink-0 text-right text-sm tabular-nums text-muted">
          {row.kind === 'MILESTONE' ? '0.0 j' : estimate ? days(estimate) : '—'}
        </span>
      </div>

      <div role="gridcell" className="relative shrink-0" style={gridStyle}>
        <Bar row={row} calendar={calendar} onOpen={open} />
      </div>
    </div>
  )
}

function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="grid size-6 place-items-center rounded-md text-muted hover:bg-elevated hover:text-fg"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Bar({ row, calendar, onOpen }: { row: Row; calendar: Calendar; onOpen: () => void }) {
  if (row.kind === 'MILESTONE' && row.milestone) {
    const left = dayIndex(calendar.start, parseDate(row.milestone.date)) * calendar.ppd + calendar.ppd / 2
    return (
      <button
        type="button"
        onClick={onOpen}
        className="absolute top-1/2 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap text-sm"
        style={{ left: left - 8 }}
      >
        <span className="ds-diamond size-4!" data-reached={row.milestone.reached} aria-hidden />
        <span className="font-medium">{shortDate(row.milestone.date)}</span>
        <span className="ds-ink" data-status={row.milestone.reached ? 'CLOSED' : 'OPEN'}>
          {row.milestone.reached ? '· Atteint ✅' : '· À venir'}
        </span>
      </button>
    )
  }

  if (!row.span) {
    return <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs italic text-muted">Non planifié</span>
  }

  const start = dayIndex(calendar.start, parseDate(row.span.start))
  const length = dayIndex(parseDate(row.span.start), parseDate(row.span.end)) + 1
  const left = start * calendar.ppd
  const barWidth = Math.max(length * calendar.ppd, 8)
  const progress = row.item ? row.item.progress : (row.aggregate?.progress ?? 0)
  const status = row.item?.status ?? row.aggregate?.status
  const hasItems = row.item !== undefined || (row.aggregate?.workItems ?? 0) > 0
  const size = row.kind === 'PHASE' ? 'lg' : row.kind === 'ITEM' ? undefined : row.kind === 'STORY' ? 'sm' : undefined
  const label = !hasItems
    ? ''
    : row.kind === 'ITEM' || row.kind === 'STORY'
      ? `${percent(progress)} · ${status ? STATUS_LABEL[status] : ''}`
      : percent(progress)

  return (
    <button
      type="button"
      onClick={onOpen}
      className="absolute top-1/2 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap"
      style={{ left }}
      title={`${row.code} · ${shortDate(row.span.start)} → ${shortDate(row.span.end)}`}
      aria-label={`${row.code} ${row.title} : du ${shortDate(row.span.start)} au ${shortDate(row.span.end)}, ${label}`}
    >
      <span
        className="ds-bar block"
        data-type={row.item?.type ?? row.kind}
        data-size={size}
        data-dimmed={row.item?.status === 'REJECTED' ? '' : undefined}
        style={{ width: barWidth }}
      >
        <span className="ds-bar__fill block" style={{ width: `${progress}%` }} />
      </span>
      {label && (
        <span className="ds-ink text-sm font-medium" data-status={row.kind === 'ITEM' || row.kind === 'STORY' ? status : 'CLOSED'}>
          {label}
        </span>
      )}
    </button>
  )
}

