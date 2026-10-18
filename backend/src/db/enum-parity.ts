// Contrôle à la compilation : les listes du domaine (src/domain/workflow.ts) et les enums du schéma Prisma
// doivent rester identiques. Une divergence fait échouer `tsc --noEmit` ici. Aucun code émis.
import type * as Prisma from '../generated/prisma/enums.ts'
import type * as Domain from '../domain/workflow.ts'

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T

export type EnumParity = [
  Assert<Same<Prisma.WorkItemType, Domain.WorkItemType>>,
  Assert<Same<Prisma.WorkItemStatus, Domain.WorkItemStatus>>,
  Assert<Same<Prisma.Priority, Domain.Priority>>,
]
