import { useId, useRef } from 'react'
import { CalendarCheck } from 'lucide-react'

import logo from '../assets/logo-atelier-projets.webp'

/**
 * Marque commune de la Suite Atelier (styles/atelier-brand, docs/SUITE.md §1.6) :
 * tuile + « atelier_Projets » ; un clic ouvre la fenêtre « À propos » avec le logo en grand.
 */
export function AtelierBrand({ showName = true, nameClassName = '' }: { showName?: boolean; nameClassName?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  return (
    <>
      <button
        type="button"
        className="atelier-brand"
        aria-haspopup="dialog"
        aria-label={showName ? undefined : "À propos d'Atelier Projets"}
        title="À propos d'Atelier Projets"
        onClick={() => dialog.current?.showModal()}
      >
        <span className="atelier-brand__tile" aria-hidden="true">
          <CalendarCheck />
        </span>
        {showName && (
          <span className={`atelier-brand__name ${nameClassName}`}>
            <span className="atelier-brand__prefix">atelier_</span>Projets
          </span>
        )}
      </button>

      <dialog
        ref={dialog}
        className="atelier-about"
        aria-labelledby={titleId}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close()
        }}
      >
        <div className="atelier-about__panel">
          <button type="button" className="atelier-about__close" aria-label="Fermer" onClick={() => dialog.current?.close()}>
            ×
          </button>
          <img className="atelier-about__logo" src={logo} alt="Logo Atelier Projets" width={576} height={528} />
          <h2 id={titleId} className="atelier-about__name">
            <span className="atelier-brand__prefix">atelier_</span>Projets
          </h2>
          <p className="atelier-about__tagline">Gestion de projet agile : Gantt, budgets, suivi Git et IA locale.</p>
          <p className="atelier-about__suite">Suite Atelier · 100 % local</p>
        </div>
      </dialog>
    </>
  )
}
