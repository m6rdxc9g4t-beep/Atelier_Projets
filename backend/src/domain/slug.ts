// Slug lisible et stable pour un projet : « App E-Commerce v2 » → « app-e-commerce-v2 ».

const MAX_SLUG_LENGTH = 60

export function slugify(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '')
  return slug === '' ? 'projet' : slug
}

/**
 * Préfixe commun à tous les candidats de uniqueSlug(base) : la base peut être tronquée pour loger le
 * suffixe (jusqu'à « -1000000000 »), donc chercher les slugs pris avec ce préfixe, pas avec la base entière.
 */
export function slugSearchPrefix(base: string): string {
  return base.slice(0, MAX_SLUG_LENGTH - 12)
}

/** Ajoute un suffixe numérique (-2, -3…) jusqu'à obtenir un slug libre. */
export function uniqueSlug(base: string, isTaken: (slug: string) => boolean): string {
  if (!isTaken(base)) return base
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!isTaken(candidate)) return candidate
  }
}

export const SLUG_PATTERN = '^[a-z0-9]+(?:-[a-z0-9]+)*$'
