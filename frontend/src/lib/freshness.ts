// Fraîcheur des données : au retour sur la fenêtre, les vues relisent l'API.
// Atelier Projets est modifié pendant qu'il est en arrière-plan : un workflow d'Atelier Nexus crée une tâche par le
// nœud, Atelier Tab envoie une table au webhook, une session Claude CLI ou un commit change un élément. Sans
// relecture, l'écran garde l'état d'avant jusqu'à la prochaine action dans l'app.

/** Absence minimale avant de relire : un aller-retour éclair (sélecteur de fichier, notification) ne relit rien. */
export const MIN_AWAY_MS = 5_000

export interface Freshness {
  /** La fenêtre passe en arrière-plan (perte du focus ou onglet masqué). */
  left(now: number): void
  /** La fenêtre revient au premier plan. */
  returned(now: number): void
  /** Ce qui retenait la relecture (un dialogue ouvert) vient de se terminer. */
  settled(): void
}

/**
 * refresh : relit les vues. isBusy : une saisie est en cours dans un dialogue — la relecture attend sa fermeture
 * (un dialogue qui relit ses données remettrait ses champs à leur valeur enregistrée).
 */
export function createFreshness({
  refresh,
  isBusy,
  minAwayMs = MIN_AWAY_MS,
}: {
  refresh: () => void
  isBusy: () => boolean
  minAwayMs?: number
}): Freshness {
  let leftAt: number | null = null
  let waiting = false
  return {
    left(now) {
      // Perte du focus puis onglet masqué : le premier des deux date l'absence.
      leftAt ??= now
    },
    returned(now) {
      if (leftAt === null) return
      const away = now - leftAt
      leftAt = null
      if (away < minAwayMs) return
      if (isBusy()) waiting = true
      else refresh()
    },
    settled() {
      if (!waiting || isBusy()) return
      waiting = false
      refresh()
    },
  }
}

/** Branche la fraîcheur sur la fenêtre (focus, visibilité de l'onglet). Renvoie la fonction de désabonnement. */
export function watchWindow(freshness: Freshness, now: () => number = Date.now): () => void {
  const onBlur = () => freshness.left(now())
  const onFocus = () => freshness.returned(now())
  const onVisibility = () => (document.hidden ? freshness.left(now()) : freshness.returned(now()))
  window.addEventListener('blur', onBlur)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
