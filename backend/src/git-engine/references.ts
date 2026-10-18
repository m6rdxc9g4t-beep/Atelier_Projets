// Références aux WorkItems dans les messages de commit, titres de Pull Request et noms de branche.
// Règle CLAUDE.md §3.3 : (feature|task|bug|fix|feat|ref)?\s*#(\d+), insensible à la casse.
import type { WorkItemStatus } from '../domain/workflow.ts'

/** Motif officiel (CLAUDE.md §3.3). Toujours utilisé via une copie : il porte le drapeau g. */
export const REFERENCE_PATTERN = /(feature|task|bug|fix|feat|ref)?\s*#(\d+)/gi

/** Plus grand #ID stockable (Int Prisma, 32 bits signés). */
const MAX_WORK_ITEM_ID = 2_147_483_647

export interface WorkItemReference {
  workItemId: number
  /** Mot-clé en minuscules (feature, task, bug, fix, feat, ref), null pour un « #ID » seul. */
  keyword: string | null
}

/**
 * Références d'un texte, sans doublon : un même #ID cité plusieurs fois garde le premier mot-clé
 * rencontré (« ref #12 … fix #12 » → ref). Les #ID impossibles (0, trop grands) sont ignorés.
 */
export function parseReferences(text: string): WorkItemReference[] {
  const references = new Map<number, WorkItemReference>()
  for (const match of text.matchAll(new RegExp(REFERENCE_PATTERN))) {
    const workItemId = Number(match[2])
    if (!Number.isSafeInteger(workItemId) || workItemId < 1 || workItemId > MAX_WORK_ITEM_ID) continue
    const keyword = match[1]?.toLowerCase() ?? null
    const known = references.get(workItemId)
    if (!known) references.set(workItemId, { workItemId, keyword })
    else if (known.keyword === null && keyword !== null) known.keyword = keyword
  }
  return [...references.values()]
}

/**
 * Références d'un message de commit. Le suffixe « (#57) » que GitHub ajoute au titre d'un squash ou d'un
 * merge désigne la Pull Request #57, pas l'élément #57 : il est ignoré.
 */
export function commitReferences(message: string): WorkItemReference[] {
  const [subject = '', ...body] = message.split('\n')
  return parseReferences([subject.replace(/\s+\(#\d+\)\s*$/, ''), ...body].join('\n'))
}

/**
 * #ID porté par un nom de branche : un segment qui commence par le numéro
 * (« feature/12345-git-sync-engine », « bug/103 », « 204_dark-mode »). Sinon null.
 */
export function branchWorkItemId(branch: string): number | null {
  const match = /(?:^|\/)(\d+)(?=$|[-_.])/.exec(branch)
  if (!match) return null
  const workItemId = Number(match[1])
  return Number.isSafeInteger(workItemId) && workItemId >= 1 && workItemId <= MAX_WORK_ITEM_ID ? workItemId : null
}

export type PullRequestState = 'OPEN' | 'MERGED' | 'CLOSED'

/**
 * Statut du workflow affiché pour une Pull Request (couleurs des statuts) :
 * brouillon → IN_PROGRESS, ouverte → IN_REVIEW, fusionnée → CLOSED, fermée sans fusion → REJECTED.
 */
export function pullRequestStatus(pr: { state: PullRequestState; draft: boolean }): WorkItemStatus {
  if (pr.state === 'MERGED') return 'CLOSED'
  if (pr.state === 'CLOSED') return 'REJECTED'
  return pr.draft ? 'IN_PROGRESS' : 'IN_REVIEW'
}
