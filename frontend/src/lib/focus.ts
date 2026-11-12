// Focus des fenêtres modales : règles pures (testées sans navigateur), appliquées par Modal (components/ui.tsx).

/**
 * Élément qui reçoit le focus quand Tab est pressée dans une fenêtre modale, ou null pour laisser faire le navigateur.
 * Tab boucle du dernier élément au premier (et l'inverse avec Maj). Un focus sorti de la fenêtre — le bouton qui
 * le portait vient d'être désactivé ou remplacé (« Charger » devenu « Ouvrir »), ou la fenêtre n'avait encore rien
 * à focaliser à son ouverture — y revient : Tab ne part jamais dans la page restée derrière.
 */
export function trapTarget<T>(focusable: readonly T[], active: T | null, inside: boolean, shift: boolean): T | null {
  const head = focusable[0]
  const tail = focusable[focusable.length - 1]
  if (head === undefined || tail === undefined) return null
  if (!inside) return shift ? tail : head
  if (shift && active === head) return tail
  if (!shift && active === tail) return head
  return null
}

/** Élément focalisé à l'ouverture : le premier champ ou bouton du contenu ; à défaut (contenu en chargement), « Fermer ». */
export function initialTarget<T>(content: T | null | undefined, close: T | null | undefined): T | null {
  return content ?? close ?? null
}
