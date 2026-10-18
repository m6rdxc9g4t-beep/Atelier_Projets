// Maquette B : santé du projet puis diagramme de Gantt (Phases > Epics > Stories > Éléments, jalons ◆).
// Le backend fournit agrégats, avancements et plages de dates ; ici, seulement la mise en page du calendrier.
import { AlertTriangle, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Flag, Pencil, Plus, Printer, Route, Sparkles } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { HealthCard } from '../components/HealthCard.tsx'
import { Button, Card, Eyebrow, ErrorNotice, Spinner, TypeChip } from '../components/ui.tsx'
import { days, parseDate, percent, shortDate, today } from '../lib/format.ts'
import { levelCode, STATUS_LABEL, TYPE_LABEL } from '../lib/labels.ts'
import { useAction } from '../lib/use-action.ts'
import { useApi } from '../lib/use-api.ts'
import { milestoneService, reportService, scheduleService, workItemService } from '../services/api.ts'
import type { Aggregate, DateSpan, Milestone, Project, ProjectTree, TreeWorkItem } from '../services/types.ts'
import { useApp, useAppState, type DialogRequest } from '../store/app.ts'

type Zoom = 'day' | 'week' | 'month'
const PX_PER_DAY: Record<Zoom, number> = { day: 34, week: 18, month: 6 }
const ZOOM_LABEL: Record<Zoom, string> = { day: 'Jour', week: 'Semaine', month: 'Mois' }
const ROW_HEIGHT = 44
/** Hauteur d'une ligne, bordure comprise (tracé des flèches de dépendance). */
const ROW_PITCH = ROW_HEIGHT + 1
const DAY_MS = 86_400_000
/** Déplacement minimal (px) pour qu'un appui sur une barre devienne un glisser-déposer plutôt qu'un clic. */
const DRAG_THRESHOLD = 4

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
      {tree.data && <Gantt tree={tree.data} project={project} />}
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
  /** Clés des lignes parentes (phase, epic, story) : elles suivent le déplacement d'un conteneur. */
  parents: string[]
  /** Ce que le glisser-déposer de la barre modifie. */
  drag?: DragTarget
}

type DragTarget =
  | { kind: 'item'; id: number; span: DateSpan; startDate: string | null; dueDate: string | null }
  | { kind: 'container'; level: 'phase' | 'epic' | 'story'; id: number }
  | { kind: 'milestone'; id: number; date: string }

type DragMode = 'move' | 'start' | 'end'

function buildRows(tree: ProjectTree, collapsed: ReadonlySet<string>): Row[] {
  const rows: Row[] = []
  const milestoneRow = (milestone: Milestone, level: number, parents: string[]): Row => ({
    key: `milestone-${milestone.id}`,
    kind: 'MILESTONE',
    level,
    code: 'MILESTONE',
    title: milestone.title,
    span: { start: milestone.date, end: milestone.date },
    milestone,
    collapsible: false,
    edit: { kind: 'editMilestone', id: milestone.id },
    parents,
    drag: { kind: 'milestone', id: milestone.id, date: milestone.date },
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
      parents: [],
      drag: phase.span ? { kind: 'container', level: 'phase', id: phase.id } : undefined,
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
        parents: [phaseKey],
        drag: epic.span ? { kind: 'container', level: 'epic', id: epic.id } : undefined,
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
          parents: [phaseKey, epicKey],
          drag: story.span ? { kind: 'container', level: 'story', id: story.id } : undefined,
        })
        if (collapsed.has(storyKey)) continue
        for (const item of story.workItems) {
          rows.push({
            key: `item-${item.id}`,
            kind: 'ITEM',
            level: 3,
            code: `#${item.id}`,
            title: item.title,
            span: item.span,
            item,
            collapsible: false,
            parents: [phaseKey, epicKey, storyKey],
            drag: item.span ? { kind: 'item', id: item.id, span: item.span, startDate: item.startDate, dueDate: item.dueDate } : undefined,
          })
        }
      }
    }
    for (const milestone of phase.milestones) rows.push(milestoneRow(milestone, 1, [phaseKey]))
  }
  for (const milestone of tree.milestones) rows.push(milestoneRow(milestone, 0, []))
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

// --- Glisser-déposer ---------------------------------------------------------------------------------

/** Déplacement en cours (ou envoyé, en attente de la relecture de l'arbre). */
interface Drag {
  rowKey: string
  mode: DragMode
  days: number
  pending: boolean
}

interface Shift {
  start: number
  end: number
}

const NO_SHIFT: Shift = { start: 0, end: 0 }

/** Décalage d'affichage d'une ligne pendant un déplacement : la ligne tirée, et le contenu d'un conteneur tiré. */
function shiftOf(row: Row, drag: Drag | null): Shift {
  if (!drag) return NO_SHIFT
  if (drag.rowKey === row.key) {
    if (drag.mode === 'start') return { start: drag.days, end: 0 }
    if (drag.mode === 'end') return { start: 0, end: drag.days }
    return { start: drag.days, end: drag.days }
  }
  return drag.mode === 'move' && row.parents.includes(drag.rowKey) ? { start: drag.days, end: drag.days } : NO_SHIFT
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function shiftDay(day: string, amount: number): string {
  return isoDay(addDays(parseDate(day), amount))
}

interface Geometry {
  /** Position et largeur (px depuis le début du calendrier). */
  left: number
  width: number
  /** Dates affichées (celles de l'aperçu pendant un déplacement). */
  start: string
  end: string
}

function barGeometry(span: DateSpan, calendar: Calendar, shift: Shift): Geometry {
  const start = dayIndex(calendar.start, parseDate(span.start)) + shift.start
  const end = Math.max(start, dayIndex(calendar.start, parseDate(span.end)) + shift.end)
  return {
    left: start * calendar.ppd,
    width: Math.max((end - start + 1) * calendar.ppd, 8),
    start: isoDay(addDays(calendar.start, start)),
    end: isoDay(addDays(calendar.start, end)),
  }
}

/** Bornes d'un redimensionnement : une barre garde au moins un jour. */
function clampDays(row: Row, mode: DragMode, value: number): number {
  if (mode === 'move' || !row.span) return value
  const length = dayIndex(parseDate(row.span.start), parseDate(row.span.end))
  return mode === 'start' ? Math.min(value, length) : Math.max(value, -length)
}

function dragMessage(row: Row, mode: DragMode, amount: number): string {
  const sign = amount > 0 ? `+${amount}` : String(amount)
  if (mode === 'start') return `${row.code} : début décalé de ${sign} j`
  if (mode === 'end') return `${row.code} : fin décalée de ${sign} j`
  return `${row.code} déplacé de ${sign} j${row.kind === 'PHASE' || row.kind === 'EPIC' || row.kind === 'STORY' ? ' avec son contenu' : ''}`
}

/** Écriture correspondant à un déplacement : dates de l'élément, décalage d'un conteneur, date d'un jalon. */
function dragAction(target: DragTarget, mode: DragMode, amount: number): () => Promise<unknown> {
  switch (target.kind) {
    case 'item': {
      // Déplacement : seules les dates renseignées bougent (une échéance seule reste une échéance seule).
      if (mode === 'move') {
        const shift = (date: string | null) => (date === null ? null : shiftDay(date, amount))
        return () => workItemService.update(target.id, { startDate: shift(target.startDate), dueDate: shift(target.dueDate) })
      }
      const startDate = mode === 'end' ? target.span.start : shiftDay(target.span.start, amount)
      const dueDate = mode === 'start' ? target.span.end : shiftDay(target.span.end, amount)
      return () => workItemService.update(target.id, { startDate, dueDate })
    }
    case 'container':
      return target.level === 'phase'
        ? () => scheduleService.shiftPhase(target.id, amount)
        : target.level === 'epic'
          ? () => scheduleService.shiftEpic(target.id, amount)
          : () => scheduleService.shiftStory(target.id, amount)
    case 'milestone':
      return () => milestoneService.update(target.id, { date: shiftDay(target.date, amount) })
  }
}

/** Tracé d'une dépendance en ligne brisée, de la fin du prédécesseur au début du successeur. */
function linkPath(x1: number, y1: number, x2: number, y2: number): string {
  if (x2 - x1 >= 14) return `M ${x1} ${y1} h 7 V ${y2} H ${x2}`
  const middle = y2 > y1 ? y2 - ROW_PITCH / 2 : y2 + ROW_PITCH / 2
  return `M ${x1} ${y1} h 7 V ${middle} H ${x2 - 10} V ${y2} H ${x2}`
}

// --- Composant ------------------------------------------------------------------------------------

function Gantt({ tree, project }: { tree: ProjectTree; project: Project }) {
  const [zoom, setZoom] = useState<Zoom>('week')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [showCritical, setShowCritical] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [linking, setLinking] = useState<{ fromId: number; x: number; y: number } | null>(null)
  const openDialog = useApp((state) => state.openDialog)
  const { busy, run } = useAction()
  const rows = useMemo(() => buildRows(tree, collapsed), [tree, collapsed])
  const calendar = useMemo(() => buildCalendar(tree, zoom), [tree, zoom])
  const scroller = useRef<HTMLDivElement>(null)
  const linkLayer = useRef<SVGSVGElement>(null)
  /** Un glisser vient de se terminer : le clic qui suit n'ouvre pas la fiche. */
  const suppressClick = useRef(false)
  /** Déplacement envoyé, arbre pas encore relu : les dates affichées sont périmées, on n'en accepte pas d'autre. */
  const pendingRef = useRef(false)
  const commitToken = useRef(0)
  const width = calendar.totalDays * calendar.ppd

  // Déplacement envoyé : l'aperçu reste en place jusqu'à l'arrivée de l'arbre relu (pas de retour en arrière).
  useEffect(() => {
    pendingRef.current = false
    setDrag((current) => (current?.pending ? null : current))
  }, [tree])

  const critical = useMemo(() => new Set(tree.criticalPath), [tree.criticalPath])
  const conflicts = useMemo(() => tree.dependencies.filter((dependency) => dependency.conflict), [tree.dependencies])
  const conflicted = useMemo(() => new Set(conflicts.map((dependency) => dependency.successorId)), [conflicts])

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

  const commit = useCallback(
    async (row: Row, mode: DragMode, amount: number) => {
      if (!row.drag || amount === 0) return setDrag(null)
      pendingRef.current = true
      setDrag({ rowKey: row.key, mode, days: amount, pending: true })
      const result = await run('drag', dragAction(row.drag, mode, amount), dragMessage(row, mode, amount))
      if (!result.ok) {
        pendingRef.current = false
        setDrag(null)
      } else {
        // Relecture de l'arbre en échec : l'aperçu ne reste pas affiché indéfiniment.
        const token = ++commitToken.current
        setTimeout(() => {
          if (!pendingRef.current || token !== commitToken.current) return
          pendingRef.current = false
          setDrag((current) => (current?.pending ? null : current))
        }, 8000)
      }
    },
    [run],
  )

  /** Appui sur une barre : clic (ouvre) sous le seuil, sinon glisser-déposer au jour près. */
  const beginDrag = useCallback(
    (row: Row, mode: DragMode, event: ReactPointerEvent) => {
      if (event.button !== 0 || !row.drag || pendingRef.current) return
      event.stopPropagation()
      const originX = event.clientX
      const ppd = calendarRef.current.ppd
      let moved = false
      let amount = 0
      const onMove = (move: PointerEvent) => {
        const dx = move.clientX - originX
        if (!moved && Math.abs(dx) < DRAG_THRESHOLD) return
        moved = true
        amount = clampDays(row, mode, Math.round(dx / ppd))
        setDrag({ rowKey: row.key, mode, days: amount, pending: false })
      }
      const finish = (cancelled: boolean) => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        if (!moved) return
        suppressClick.current = true
        setTimeout(() => (suppressClick.current = false))
        if (cancelled) setDrag(null)
        else void commit(row, mode, amount)
      }
      const onUp = () => finish(false)
      const onCancel = () => finish(true)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
    },
    [commit],
  )

  /** Tirer le rond au bout d'une barre jusqu'à un autre élément : celui-ci attendra la fin du premier. */
  const beginLink = useCallback(
    (row: Row, event: ReactPointerEvent) => {
      if (event.button !== 0 || !row.item) return
      event.stopPropagation()
      event.preventDefault()
      const fromId = row.item.id
      const locate = (clientX: number, clientY: number) => {
        const rect = linkLayer.current?.getBoundingClientRect()
        return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: 0, y: 0 }
      }
      setLinking({ fromId, ...locate(event.clientX, event.clientY) })
      const onMove = (move: PointerEvent) => setLinking({ fromId, ...locate(move.clientX, move.clientY) })
      const stop = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', stop)
        setLinking(null)
      }
      const onUp = (up: PointerEvent) => {
        stop()
        const target = document.elementFromPoint(up.clientX, up.clientY)?.closest<HTMLElement>('[data-item-id]')
        const targetId = Number(target?.dataset.itemId)
        if (!Number.isInteger(targetId) || targetId === fromId) return
        void run('link', () => scheduleService.addDependency(targetId, fromId), `#${targetId} commencera après la fin de #${fromId}`)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', stop)
    },
    [run],
  )

  const onBarKey = useCallback(
    (row: Row, event: ReactKeyboardEvent) => {
      if (!event.altKey || !row.drag || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
      event.preventDefault()
      if (pendingRef.current) return
      const mode: DragMode = event.shiftKey && row.drag.kind === 'item' ? 'end' : 'move'
      void commit(row, mode, clampDays(row, mode, event.key === 'ArrowLeft' ? -1 : 1))
    },
    [commit],
  )

  const open = useCallback((row: Row) => {
    if (suppressClick.current) return
    const { openWorkItem, openDialog: open } = useApp.getState()
    if (row.item) openWorkItem(row.item.id)
    else if (row.edit) open(row.edit)
  }, [])

  const printGantt = () => {
    const content = scroller.current?.querySelector<HTMLElement>('.gantt-content')
    if (!content) return
    const root = document.documentElement
    const theme = root.dataset.theme
    // A4 paysage, marges de 10 mm : ≈ 1045 px imprimables ; le diagramme (colonne « Hiérarchie » de
    // 21rem à l'impression) est réduit pour tenir en largeur.
    const left = (content.firstElementChild?.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0
    const printWidth = content.scrollWidth - left + 21 * 16
    root.style.setProperty('--print-scale', String(Math.min(1, 1040 / printWidth)))
    root.dataset.printing = 'gantt'
    root.dataset.theme = 'light'
    const restore = () => {
      window.removeEventListener('afterprint', restore)
      delete root.dataset.printing
      root.style.removeProperty('--print-scale')
      if (theme) root.dataset.theme = theme
    }
    window.addEventListener('afterprint', restore)
    window.print()
  }

  const rowIndex = useMemo(() => new Map(rows.map((row, index) => [row.key, index])), [rows])
  const geometryOf = (row: Row) => (row.span ? barGeometry(row.span, calendar, shiftOf(row, drag)) : null)

  const links = tree.dependencies.flatMap((dependency) => {
    const fromIndex = rowIndex.get(`item-${dependency.predecessorId}`)
    const toIndex = rowIndex.get(`item-${dependency.successorId}`)
    if (fromIndex === undefined || toIndex === undefined) return []
    const from = geometryOf(rows[fromIndex] as Row)
    const to = geometryOf(rows[toIndex] as Row)
    if (!from || !to) return []
    const tone = dependency.conflict
      ? 'conflict'
      : showCritical && critical.has(dependency.predecessorId) && critical.has(dependency.successorId)
        ? 'critical'
        : 'normal'
    return [
      {
        key: `${dependency.predecessorId}-${dependency.successorId}`,
        successorId: dependency.successorId,
        d: linkPath(from.left + from.width, fromIndex * ROW_PITCH + ROW_HEIGHT / 2, to.left, toIndex * ROW_PITCH + ROW_HEIGHT / 2),
        tone,
        label: `#${dependency.predecessorId} → #${dependency.successorId} · ${
          dependency.slackDays === null ? 'marge non calculée (élément non planifié ou rejeté)' : dependency.conflict ? `conflit : ${-dependency.slackDays} j de chevauchement` : `marge ${dependency.slackDays} j`
        }`,
      },
    ]
  })
  const linkSource = linking ? rows[rowIndex.get(`item-${linking.fromId}`) ?? -1] : undefined
  const linkSourceGeometry = linkSource ? geometryOf(linkSource) : null
  const markerId = useId().replace(/:/g, '')

  return (
    <Card className="gantt-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <Eyebrow>
          Diagramme de Gantt &amp; jalons <span className="hidden print:inline">· {project.name} · {shortDate(today())}</span>
        </Eyebrow>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {conflicts.length > 0 && (
            <Button
              size="sm"
              variant="danger"
              icon={<AlertTriangle className="size-4" />}
              busy={busy === 'resolve'}
              title="Décaler les éléments qui commencent avant la fin de leurs prédécesseurs (durées conservées)"
              onClick={() =>
                run('resolve', async () => {
                  const { moved } = await scheduleService.resolve(project.id)
                  useApp.getState().notify('success', moved.length === 0 ? 'Rien à replanifier' : `${moved.length} élément(s) replanifié(s)`)
                })
              }
            >
              {conflicts.length} conflit{conflicts.length > 1 ? 's' : ''} · Replanifier
            </Button>
          )}
          <Button
            size="sm"
            icon={<Route className="size-4" />}
            aria-pressed={showCritical}
            variant={showCritical ? 'primary' : 'default'}
            title="Éléments dont tout retard repousse la fin du projet"
            onClick={() => setShowCritical((value) => !value)}
          >
            Chemin critique
          </Button>
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
          <Button size="sm" icon={<Printer className="size-4" />} title="Imprimer ou enregistrer en PDF (A4 paysage)" onClick={printGantt} disabled={rows.length === 0}>
            PDF
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
        <div
          ref={scroller}
          className={`gantt relative max-h-[calc(100vh-15rem)] min-h-64 overflow-auto ${drag && !drag.pending ? 'cursor-grabbing select-none' : ''}`}
          role="grid"
          aria-label="Diagramme de Gantt"
          aria-describedby={`${markerId}-help`}
        >
          <p id={`${markerId}-help`} className="sr-only">
            Glisser une barre pour la déplacer, ses bords pour changer les dates, le rond au bout d’une barre vers un autre élément pour créer
            une dépendance. Au clavier : Alt + flèche gauche ou droite déplace d’un jour ; avec Maj, la fin seulement.
          </p>
          <div className="gantt-content relative" style={{ width: `calc(var(--gantt-left) + ${width}px)` }}>
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

            <div className="relative">
              {rows.map((row) => (
                <GanttRow
                  key={row.key}
                  row={row}
                  calendar={calendar}
                  width={width}
                  collapsed={collapsed.has(row.key)}
                  onToggle={() => toggle(row.key)}
                  geometry={geometryOf(row)}
                  dragging={drag?.rowKey === row.key}
                  critical={showCritical && row.item !== undefined && critical.has(row.item.id)}
                  faded={showCritical && row.item !== undefined && !critical.has(row.item.id)}
                  conflict={row.item !== undefined && conflicted.has(row.item.id)}
                  linkTarget={linking !== null && row.item !== undefined && row.item.id !== linking.fromId}
                  onOpen={open}
                  onDragStart={beginDrag}
                  onLinkStart={beginLink}
                  onBarKey={onBarKey}
                />
              ))}

              {/* Dépendances : sous la colonne figée (z-10), au-dessus des lignes. */}
              <svg
                ref={linkLayer}
                className="gantt-links pointer-events-none absolute top-0 z-[5]"
                style={{ left: 'var(--gantt-left)', width, height: rows.length * ROW_PITCH }}
                aria-hidden
              >
                <defs>
                  {(['normal', 'critical', 'conflict'] as const).map((tone) => (
                    <marker key={tone} id={`${markerId}-${tone}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M 0 0 L 8 4 L 0 8 z" className="gantt-link-head" data-tone={tone} />
                    </marker>
                  ))}
                </defs>
                {links.map((link) => (
                  <g key={link.key} className="gantt-link" data-tone={link.tone}>
                    <path d={link.d} className="gantt-link-line" markerEnd={`url(#${markerId}-${link.tone})`} />
                    <path
                      d={link.d}
                      className="gantt-link-hit"
                      onClick={() => useApp.getState().openWorkItem(link.successorId)}
                    >
                      <title>{link.label}</title>
                    </path>
                  </g>
                ))}
                {linking && linkSourceGeometry && linkSource && (
                  <path
                    className="gantt-link-draft"
                    d={`M ${linkSourceGeometry.left + linkSourceGeometry.width} ${(rowIndex.get(linkSource.key) ?? 0) * ROW_PITCH + ROW_HEIGHT / 2} L ${linking.x} ${linking.y}`}
                    markerEnd={`url(#${markerId}-normal)`}
                  />
                )}
              </svg>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

interface GanttRowProps {
  row: Row
  calendar: Calendar
  width: number
  collapsed: boolean
  onToggle: () => void
  geometry: Geometry | null
  dragging: boolean
  critical: boolean
  faded: boolean
  conflict: boolean
  linkTarget: boolean
  onOpen: (row: Row) => void
  onDragStart: (row: Row, mode: DragMode, event: ReactPointerEvent) => void
  onLinkStart: (row: Row, event: ReactPointerEvent) => void
  onBarKey: (row: Row, event: ReactKeyboardEvent) => void
}

function GanttRow(props: GanttRowProps) {
  const { row, calendar, width, collapsed, onToggle, linkTarget } = props
  const { openDialog, selected } = useAppState((state) => ({
    openDialog: state.openDialog,
    selected: state.selectedWorkItemId,
  }))
  const isItem = row.kind === 'ITEM' && row.item
  const isSelected = isItem && selected === row.item?.id
  const kindAttr = row.item ? row.item.type : row.kind
  const container = row.kind === 'PHASE' || row.kind === 'EPIC'

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
      data-item-id={row.item?.id}
      className={`group flex border-b border-line ${container ? 'bg-sunken' : ''} ${
        isSelected ? 'bg-accent-soft' : linkTarget ? 'hover:bg-accent-soft' : 'hover:bg-hover'
      }`}
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
            className="grid size-5 shrink-0 place-items-center rounded text-muted hover:text-fg print:invisible"
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
          onClick={() => props.onOpen(row)}
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
        <span className="absolute right-16 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-line bg-surface p-0.5 shadow-card group-focus-within:flex group-hover:flex print:hidden!">
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
        <Bar {...props} />
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

function Bar({ row, calendar, geometry, dragging, critical, faded, conflict, onOpen, onDragStart, onLinkStart, onBarKey }: GanttRowProps) {
  const draggable = row.drag !== undefined
  const dragHint = draggable ? ' — glisser pour déplacer (Alt + ←/→)' : ''

  if (row.kind === 'MILESTONE' && row.milestone) {
    const date = geometry?.start ?? row.milestone.date
    const left = dayIndex(calendar.start, parseDate(date)) * calendar.ppd + calendar.ppd / 2
    return (
      <button
        type="button"
        onClick={() => onOpen(row)}
        onPointerDown={(event) => onDragStart(row, 'move', event)}
        onKeyDown={(event) => onBarKey(row, event)}
        className={`absolute top-1/2 flex -translate-y-1/2 touch-none items-center gap-2 whitespace-nowrap text-sm ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ left: left - 8 }}
        title={`${row.title}${dragHint}`}
      >
        <span className="ds-diamond size-4!" data-reached={row.milestone.reached} aria-hidden />
        <span className="font-medium">{shortDate(date)}</span>
        <span className="ds-ink" data-status={row.milestone.reached ? 'CLOSED' : 'OPEN'}>
          {row.milestone.reached ? '· Atteint ✅' : '· À venir'}
        </span>
      </button>
    )
  }

  if (!row.span || !geometry) {
    return <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs italic text-muted">Non planifié</span>
  }

  const progress = row.item ? row.item.progress : (row.aggregate?.progress ?? 0)
  const status = row.item?.status ?? row.aggregate?.status
  const hasItems = row.item !== undefined || (row.aggregate?.workItems ?? 0) > 0
  const size = row.kind === 'PHASE' ? 'lg' : row.kind === 'ITEM' ? undefined : row.kind === 'STORY' ? 'sm' : undefined
  const label = !hasItems
    ? ''
    : row.kind === 'ITEM' || row.kind === 'STORY'
      ? `${percent(progress)} · ${status ? STATUS_LABEL[status] : ''}`
      : percent(progress)
  const { start: shownStart, end: shownEnd } = geometry
  const dates = `${shortDate(shownStart)} → ${shortDate(shownEnd)}`
  const isItem = row.drag?.kind === 'item'

  return (
    <>
      <button
        type="button"
        onClick={() => onOpen(row)}
        onPointerDown={(event) => onDragStart(row, 'move', event)}
        onKeyDown={(event) => onBarKey(row, event)}
        className={`absolute top-1/2 flex -translate-y-1/2 touch-none items-center gap-2 whitespace-nowrap ${draggable ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
        style={{ left: geometry.left }}
        title={`${row.code} · ${dates}${dragHint}${isItem ? ' ; bords : changer le début ou la fin (Alt + Maj + ←/→)' : ''}`}
        aria-label={`${row.code} ${row.title} : du ${shortDate(shownStart)} au ${shortDate(shownEnd)}, ${label}${conflict ? ', en conflit avec un prédécesseur' : ''}${critical ? ', sur le chemin critique' : ''}`}
      >
        <span
          className="ds-bar block"
          data-type={row.item?.type ?? row.kind}
          data-size={size}
          data-dimmed={row.item?.status === 'REJECTED' ? '' : undefined}
          data-critical={critical ? '' : undefined}
          data-conflict={conflict ? '' : undefined}
          data-faded={faded ? '' : undefined}
          data-dragging={dragging ? '' : undefined}
          style={{ width: geometry.width }}
        >
          <span className="ds-bar__fill block" style={{ width: `${progress}%` }} />
          {isItem && geometry.width >= 24 && (
            <>
              <span
                className="gantt-handle left-0"
                onPointerDown={(event) => onDragStart(row, 'start', event)}
                aria-hidden
              />
              <span
                className="gantt-handle right-0"
                onPointerDown={(event) => onDragStart(row, 'end', event)}
                aria-hidden
              />
            </>
          )}
        </span>
        {dragging ? (
          <span className="rounded-md bg-elevated px-1.5 py-0.5 text-xs font-semibold shadow-card">{dates}</span>
        ) : (
          label && (
            <span className="ds-ink text-sm font-medium" data-status={row.kind === 'ITEM' || row.kind === 'STORY' ? status : 'CLOSED'}>
              {label}
            </span>
          )
        )}
      </button>
      {row.item && (
        <span
          className="gantt-link-handle"
          style={{ left: geometry.left + geometry.width + 3 }}
          onPointerDown={(event) => onLinkStart(row, event)}
          title={`Tirer vers un autre élément : il attendra la fin de ${row.code}`}
          aria-hidden
        />
      )}
    </>
  )
}
