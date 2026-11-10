// Lien profond venu d'une autre app de la suite (Atelier Hub, docs/SUITE.md §3) :
//   ?projet=<id>               ouvre ce projet
//   ?projet=<id>&element=<id>  ouvre ce projet et la fiche de cet élément
// Lu une fois au démarrage, avant le premier rendu, puis retiré de l'adresse (un rechargement garde le choix
// enregistré, pas le lien). Un projet absent est traité comme un choix enregistré disparu (App.tsx).

export interface DeepLink {
  projectId: number
  workItemId: number | null
}

const id = (value: string | null): number | null => (value !== null && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : null)

export function readDeepLink(search: string): DeepLink | null {
  const params = new URLSearchParams(search)
  const projectId = id(params.get('projet'))
  if (projectId === null) return null
  return { projectId, workItemId: id(params.get('element')) }
}

/** Adresse sans les paramètres du lien (les autres sont gardés). */
export function withoutDeepLink(href: string): string {
  const url = new URL(href)
  url.searchParams.delete('projet')
  url.searchParams.delete('element')
  return `${url.pathname}${url.search}${url.hash}`
}
