// Fabrique du client Prisma 7 : client TypeScript généré + adaptateur SQLite (better-sqlite3).
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient, type Prisma } from '../generated/prisma/client.ts'

export type { PrismaClient }

/**
 * Client ou transaction en cours : les services qui acceptent un `Db` peuvent être appelés dans la transaction
 * d'un appelant (idempotence, journal d'événements) ; un `$transaction` imbriqué rejoint alors la transaction englobante.
 */
export type Db = Prisma.TransactionClient

/** Crée un client relié à la base SQLite désignée par une URL « file: » absolue (voir resolveDatabaseUrl). */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) })
}
