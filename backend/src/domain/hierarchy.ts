// Hiérarchie : numérotation affichée (« PHASE 1 > EPIC 2 > STORY 2.1 ») et plages de dates du Gantt.
import { formatDateOnly } from './dates.ts'

interface Positioned {
  id: number
  position: number
}

/** Ordre d'affichage : position, puis id (ordre de création) en cas d'égalité. */
export function byPosition(a: Positioned, b: Positioned): number {
  return a.position - b.position || a.id - b.id
}

export interface HierarchyShape extends Positioned {
  epics: ReadonlyArray<Positioned & { stories: ReadonlyArray<Positioned> }>
}

export interface HierarchyCodes {
  phases: Map<number, string>
  epics: Map<number, string>
  stories: Map<number, string>
}

/**
 * Codes des conteneurs : phases et epics sont numérotés sur l'ensemble du projet (EPIC 2 = premier epic
 * de la phase 2 dans la démo), les stories par epic (« 1.2 » = 2e story de l'epic 1).
 */
export function computeCodes(phases: readonly HierarchyShape[]): HierarchyCodes {
  const codes: HierarchyCodes = { phases: new Map(), epics: new Map(), stories: new Map() }
  let epicNumber = 0
  for (const [phaseIndex, phase] of [...phases].sort(byPosition).entries()) {
    codes.phases.set(phase.id, String(phaseIndex + 1))
    for (const epic of [...phase.epics].sort(byPosition)) {
      epicNumber += 1
      codes.epics.set(epic.id, String(epicNumber))
      for (const [storyIndex, story] of [...epic.stories].sort(byPosition).entries()) {
        codes.stories.set(story.id, `${epicNumber}.${storyIndex + 1}`)
      }
    }
  }
  return codes
}

/** Plage de dates calendaires (YYYY-MM-DD, bornes incluses). */
export interface DateSpan {
  start: string
  end: string
}

/**
 * Plage effective d'un élément du Gantt : ses propres dates priment ; une borne manquante est prise
 * dans ses enfants, sinon dans l'autre borne (jalon ponctuel). Aucune date nulle part → null.
 */
export function effectiveSpan(
  own: { startDate: Date | null; dueDate: Date | null },
  children: ReadonlyArray<DateSpan | null> = [],
): DateSpan | null {
  const childSpan = enclosingSpan(children)
  const ownStart = own.startDate ? formatDateOnly(own.startDate) : null
  const ownEnd = own.dueDate ? formatDateOnly(own.dueDate) : null
  const start = ownStart ?? childSpan?.start ?? ownEnd
  const end = ownEnd ?? childSpan?.end ?? ownStart
  if (start === null || end === null) return null
  return start <= end ? { start, end } : { start: end, end: start }
}

/** Plus petite plage contenant toutes les plages données (les null sont ignorés). */
export function enclosingSpan(spans: ReadonlyArray<DateSpan | null>): DateSpan | null {
  let start: string | null = null
  let end: string | null = null
  for (const span of spans) {
    if (span === null) continue
    if (start === null || span.start < start) start = span.start
    if (end === null || span.end > end) end = span.end
  }
  return start === null || end === null ? null : { start, end }
}
