// Sélecteur « Suite Atelier » (docs/SUITE.md §3) : icône grille à gauche du nom de l'application, menu des
// trois applications (courante cochée), indicateur « en marche / arrêtée » pour celles qui ont une API.
// Clavier : Entrée / Espace / ↓ ouvrent le menu, ↑ ↓ Début Fin naviguent, Échap ferme et rend le focus,
// Tab ou un clic à l'extérieur ferment. Les vérifications de santé ne bloquent jamais le menu.
import { BarChart3, Check, KanbanSquare, LayoutGrid, Table2 } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { checkHealth, CURRENT_APP, SUITE_APPS, type SuiteAppId, type SuiteStatus } from '../lib/suite.ts'

const ICONS: Record<SuiteAppId, ReactNode> = {
  viz: <BarChart3 className="size-5" aria-hidden />,
  tab: <Table2 className="size-5" aria-hidden />,
  projets: <KanbanSquare className="size-5" aria-hidden />,
}

type Health = SuiteStatus | 'checking'

const HEALTH_TEXT: Record<Health, string> = { up: 'En marche', down: 'Arrêtée', checking: 'Vérification…' }
/** Teinte de la pastille : statuts officiels (succès / danger), neutre pendant la vérification. */
const HEALTH_STATUS: Record<Health, string> = { up: 'CLOSED', down: 'REJECTED', checking: 'OPEN' }

export function SuiteSwitcher() {
  const [open, setOpen] = useState(false)
  const [health, setHealth] = useState<Partial<Record<SuiteAppId, Health>>>({})
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = useRef<(HTMLElement | null)[]>([])
  const menuId = useId()

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }, [])

  // Santé relue à chaque ouverture, en parallèle, sans attendre pour afficher le menu.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    for (const app of SUITE_APPS) {
      if (!app.healthUrl) continue
      setHealth((current) => ({ ...current, [app.id]: 'checking' }))
      void checkHealth(app.healthUrl).then((status) => {
        if (!cancelled) setHealth((current) => ({ ...current, [app.id]: status }))
      })
    }
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false)
    }
    // Phase de capture + preventDefault : Échap ferme le menu seul, pas la fiche élément ouverte derrière.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, close])

  const focusItem = (index: number) => {
    const list = items.current.filter((item): item is HTMLElement => item !== null)
    list[(index + list.length) % list.length]?.focus()
  }

  const openMenu = (focus: 'first' | 'last') => {
    setOpen(true)
    requestAnimationFrame(() => focusItem(focus === 'first' ? 0 : -1))
  }

  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu(event.key === 'ArrowDown' ? 'first' : 'last')
    }
  }

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items.current.filter((item): item is HTMLElement => item !== null)
    const index = list.indexOf(document.activeElement as HTMLElement)
    const moves: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1 }
    if (event.key in moves) {
      event.preventDefault()
      focusItem(moves[event.key]!)
    } else if (event.key === 'Tab') {
      close(false)
    }
  }

  return (
    <div className="relative" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="ds-btn"
        data-variant="ghost"
        data-icon-only=""
        aria-label="Suite Atelier : changer d’application"
        title="Suite Atelier"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openMenu('first'))}
        onKeyDown={onTriggerKey}
      >
        <LayoutGrid className="size-5" aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Suite Atelier"
          className="ds-card absolute left-0 top-full z-40 mt-2 w-80 p-1.5 shadow-overlay"
          onKeyDown={onMenuKey}
        >
          <p className="ds-eyebrow px-2.5 pb-1.5 pt-1" aria-hidden>
            Suite Atelier
          </p>
          {SUITE_APPS.map((app, index) => {
            const current = app.id === CURRENT_APP
            const state = app.healthUrl ? (health[app.id] ?? 'checking') : null
            const content = (
              <>
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-sunken text-accent-ink">{ICONS[app.id]}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-semibold">
                    {app.name}
                    {state && (
                      <span className="flex items-center gap-1 text-xs font-normal text-muted" data-status={HEALTH_STATUS[state]}>
                        <span className="ds-dot" aria-hidden />
                        {HEALTH_TEXT[state]}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted">{app.description}</span>
                </span>
                <span className="grid size-5 shrink-0 place-items-center text-accent-ink">
                  {current && <Check className="size-4" aria-label="Application courante" />}
                </span>
              </>
            )
            const className = 'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-hover focus-visible:bg-hover'
            const label = `${app.name}${current ? ' (application courante)' : ''}${state ? ` — ${HEALTH_TEXT[state]}` : ''}`
            return current ? (
              <button
                key={app.id}
                ref={(element) => {
                  items.current[index] = element
                }}
                type="button"
                role="menuitemradio"
                aria-checked="true"
                aria-label={label}
                className={className}
                onClick={() => close(true)}
              >
                {content}
              </button>
            ) : (
              <a
                key={app.id}
                ref={(element) => {
                  items.current[index] = element
                }}
                role="menuitemradio"
                aria-checked="false"
                aria-label={label}
                href={app.url}
                target="_blank"
                rel="noreferrer"
                className={className}
                onClick={() => close(false)}
              >
                {content}
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
