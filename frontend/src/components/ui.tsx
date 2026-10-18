// Briques d'interface React au-dessus des composants CSS du design system (classes ds-*).
// Elles ne portent aucune couleur : la teinte vient des attributs data-type / data-status / data-priority.
import { Loader2, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { clampPercent } from '../lib/format.ts'
import { PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from '../lib/labels.ts'
import type { Priority, WorkItemStatus, WorkItemType } from '../services/types.ts'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  icon?: ReactNode
  busy?: boolean
}

export function Button({ variant = 'default', size = 'md', icon, busy, children, className, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`ds-btn ${className ?? ''}`}
      data-variant={variant === 'default' ? undefined : variant}
      data-size={size === 'sm' ? 'sm' : undefined}
      data-icon-only={children === undefined ? '' : undefined}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ds-card ${className ?? ''}`} {...rest} />
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={`ds-eyebrow ${className ?? ''}`}>{children}</h2>
}

export function TypeChip({ type, size }: { type: WorkItemType | 'PHASE' | 'EPIC' | 'STORY' | 'MILESTONE'; size?: 'lg' }) {
  return <span className="ds-type-chip" data-type={type} data-size={size} aria-hidden />
}

export function StatusBadge({ status, code }: { status: WorkItemStatus; code?: boolean }) {
  return (
    <span className="ds-badge" data-status={status}>
      {code ? status.replace('_', ' ') : STATUS_LABEL[status]}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className="ds-badge" data-priority={priority}>
      {priority === 'HIGH' || priority === 'IMMEDIATE' ? '🔥 ' : ''}
      {PRIORITY_LABEL[priority]}
    </span>
  )
}

/** « FEATURE » coloré selon le type. */
export function TypeLabel({ type, className }: { type: WorkItemType; className?: string }) {
  return (
    <span className={`ds-ink font-semibold uppercase tracking-wide ${className ?? ''}`} data-type={type}>
      {TYPE_LABEL[type]}
    </span>
  )
}

export function ProgressBar({
  value,
  tone,
  label,
  className,
}: {
  value: number | null | undefined
  tone?: 'budget' | 'progress' | 'over'
  label: string
  className?: string
}) {
  const width = clampPercent(value)
  return (
    <div
      className={`ds-progress ${className ?? ''}`}
      data-tone={tone}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
    >
      <div className="ds-progress__bar" style={{ inlineSize: `${width}%` }} />
    </div>
  )
}

export function Spinner({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <p className="text-base font-semibold">{title}</p>
      {children && <div className="max-w-md text-muted">{children}</div>}
    </div>
  )
}

export function ErrorNotice({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="ds-card flex flex-wrap items-center justify-between gap-3 p-4" role="alert" data-status="REJECTED">
      <p className="ds-ink">{error.message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="ds-label">
      <span>{label}</span>
      {children}
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  )
}

export function MarkdownText({ children, empty }: { children: string; empty: string }) {
  if (children.trim() === '') return <p className="text-muted italic">{empty}</p>
  return (
    <div className="ds-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {children}
      </Markdown>
    </div>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: { id: T; label: ReactNode }[]
  value: T
  onChange: (id: T) => void
  label: string
  className?: string
}) {
  return (
    <div className={`ds-tabs ${className ?? ''}`} role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="ds-tab"
          aria-selected={tab.id === value}
          tabIndex={tab.id === value ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            const index = tabs.findIndex((candidate) => candidate.id === value)
            const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
            if (step === 0) return
            event.preventDefault()
            const next = tabs[(index + step + tabs.length) % tabs.length]
            if (next) onChange(next.id)
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

/** Fenêtre modale accessible : Échap ferme, le focus reste dans la fenêtre. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])')
    first?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if (event.key !== 'Tab' || !panel.current) return
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')].filter(
        (element) => !element.hasAttribute('disabled'),
      )
      const [head, tail] = [focusable[0], focusable[focusable.length - 1]]
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault()
        tail?.focus()
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault()
        head?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-backdrop p-4 pt-[10vh] backdrop-blur-sm">
      <div className="fixed inset-0" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`ds-card relative w-full ${width} shadow-overlay`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <Button variant="ghost" size="sm" icon={<X className="size-4" />} onClick={onClose} aria-label="Fermer" data-close="" />
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
