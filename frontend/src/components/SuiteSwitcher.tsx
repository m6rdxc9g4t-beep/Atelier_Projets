// Sélecteur « Suite Atelier » (docs/SUITE.md §3) : icône grille à gauche du nom de l'application, menu des
// applications de la suite (courante cochée), indicateur « en marche / arrêtée » pour les trois apps locales (Tab :
// route de santé seule ; l'application courante est toujours « en marche », sans être sondée). Atelier Cuisine,
// app en ligne sans API locale, n'est jamais sondée : mention « En ligne ».
// Clavier : Entrée / Espace / ↓ ouvrent le menu, ↑ ↓ Début Fin naviguent, Échap ferme et rend le focus,
// Tab ou un clic à l'extérieur ferment. Les vérifications de santé ne bloquent jamais le menu.
import { ChartColumn, Check, Kanban, LayoutGrid, Table, Utensils } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { checkAnyHealth, CURRENT_APP, SUITE_APPS, type SuiteAppId, type SuiteStatus } from '../lib/suite.ts'

/** Icônes Lucide de la marque commune (docs/SUITE.md §1.6), dans l'icône carrée de chaque app ; chaque icône porte
 * le data-atelier-app de son application, donc sa couleur signature (§1.7). */
const ICONS: Record<SuiteAppId, ReactNode> = {
  viz: <ChartColumn />,
  tab: <Table />,
  projets: <Kanban />,
  cuisine: <Utensils />,
}

type Health = SuiteStatus | 'checking'

const HEALTH_TEXT: Record<Health, string> = { up: 'En marche', down: 'Arrêtée', checking: 'Vérification…' }
/** Mention des apps en ligne, jamais sondées (docs/SUITE.md §3). */
const ONLINE_TEXT = 'En ligne'
/** État d'une app (charte v2) : seule l'app arrêtée est colorée (rouge) ; en marche, simple mention ; vérification : cercle vide. */
const HEALTH_CLASS: Record<Health, string> = {
  up: 'text-muted',
  down: 'font-medium text-down before:bg-down',
  checking: 'text-faint before:bg-transparent before:shadow-[inset_0_0_0_1.5px_currentColor]',
}

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
      // L'application courante n'est jamais sondée : elle est « en marche » puisqu'elle affiche ce menu (§3).
      if (app.id === CURRENT_APP || app.healthUrls.length === 0) continue
      setHealth((current) => ({ ...current, [app.id]: 'checking' }))
      void checkAnyHealth(app.healthUrls).then((status) => {
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
        data-size="sm"
        data-icon-only=""
        aria-label="Suite Atelier : changer d’application"
        title="Suite Atelier"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openMenu('first'))}
        onKeyDown={onTriggerKey}
      >
        <LayoutGrid aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Suite Atelier"
          className="ds-card absolute left-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-1.75rem)] p-1 shadow-overlay max-md:left-auto max-md:right-0"
          onKeyDown={onMenuKey}
        >
          <p className="px-2 pb-1 pt-1.5 text-xs font-medium text-faint" aria-hidden>
            Suite Atelier
          </p>
          {SUITE_APPS.map((app, index) => {
            const current = app.id === CURRENT_APP
            const state: Health | null = current ? 'up' : app.healthUrls.length > 0 ? (health[app.id] ?? 'checking') : null
            const online = !current && state === null && app.online === true
            const content = (
              <>
                <span className="atelier-brand__tile atelier-brand__tile--sm" data-atelier-app={app.id} aria-hidden="true">
                  {ICONS[app.id]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="atelier-brand__name atelier-brand__name--sm">
                      <span className="atelier-brand__prefix">Atelier </span>
                      {app.short}
                    </span>
                    {state && (
                      <span
                        className={`ml-auto flex items-center gap-1.5 text-xs ${HEALTH_CLASS[state]} ${
                          state === 'up' ? '' : "before:size-2 before:shrink-0 before:rounded-full before:content-['']"
                        }`}
                      >
                        {HEALTH_TEXT[state]}
                      </span>
                    )}
                    {online && <span className="ml-auto text-xs text-muted">{ONLINE_TEXT}</span>}
                  </span>
                  <span className="block truncate text-xs text-muted">{app.description}</span>
                </span>
                <span className="grid size-5 shrink-0 place-items-center text-accent-ink">
                  {current && <Check className="size-4" aria-label="Application courante" />}
                </span>
              </>
            )
            const className = 'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover focus-visible:bg-hover'
            const label = `${app.name}${current ? ' (application courante)' : ''}${state ? ` — ${HEALTH_TEXT[state]}` : online ? ` — ${ONLINE_TEXT}` : ''}`
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
