// Journal d'avancement (onglet 2 d'un WorkItem) : Markdown fait d'entrées horodatées, au format des
// maquettes (README §4.C) : « > **18 Oct 2026 - 16h30 (4.5h passées) :** Mise en place d'un hook… »
import { roundTo } from './durations.ts'

const MONTHS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'] as const

export interface LogEntryInput {
  /** Texte Markdown de l'entrée (une ou plusieurs lignes). */
  text: string
  /** Horodatage de l'entrée. */
  at: Date
  /** Temps passé mentionné dans l'en-tête (« 4.5h passées ») ; informatif, distinct des saisies de temps. */
  hours?: number | null
}

/** Formate une entrée en citation Markdown ; l'heure est exprimée dans le fuseau donné (ex. Europe/Paris). */
export function formatLogEntry(entry: LogEntryInput, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(entry.at)
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? ''
  const month = MONTHS[Number(part('month')) - 1] ?? part('month')
  const spent = entry.hours === undefined || entry.hours === null ? '' : ` (${roundTo(entry.hours, 2)}h passées)`

  const [first = '', ...rest] = entry.text.trim().split(/\r?\n/)
  const header = `> **${part('day')} ${month} ${part('year')} - ${part('hour')}h${part('minute')}${spent} :** ${first}`
  return [header, ...rest.map((line) => (line.trim() === '' ? '>' : `> ${line}`))].join('\n')
}

/** Ajoute une entrée en fin de journal, séparée de la précédente par une ligne vide. */
export function appendLogEntry(log: string, entry: string): string {
  const current = log.trimEnd()
  return current === '' ? entry : `${current}\n\n${entry}`
}
