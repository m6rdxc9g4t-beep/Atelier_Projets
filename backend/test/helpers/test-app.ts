// Contexte de test : base SQLite temporaire migrée avec les migrations versionnées (SQL appliqué tel quel,
// sans moteur Prisma), projet de démo optionnel, application Fastify prête pour app.inject().
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { InjectOptions, LightMyRequestResponse } from 'fastify'
import { seedDemoProject } from '../../prisma/demo-project.ts'
import { buildApp, type App, type BuildAppOptions } from '../../src/app.ts'
import { BACKEND_ROOT } from '../../src/config.ts'
import { createPrismaClient, type PrismaClient } from '../../src/db/client.ts'

export interface TestContext {
  app: App
  prisma: PrismaClient
  /** Id du projet de démo (seed: true), sinon 0. */
  demoProjectId: number
  close(): Promise<void>
}

async function applyMigrations(databaseFile: string): Promise<void> {
  const migrationsDir = path.join(BACKEND_ROOT, 'prisma', 'migrations')
  const migrations = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const db = new Database(databaseFile)
  try {
    for (const name of migrations) db.exec(await readFile(path.join(migrationsDir, name, 'migration.sql'), 'utf8'))
  } finally {
    db.close()
  }
}

export async function createTestContext({
  seed = false,
  ...options
}: { seed?: boolean } & Partial<Omit<BuildAppOptions, 'prisma' | 'logger'>> = {}): Promise<TestContext> {
  const dir = await mkdtemp(path.join(tmpdir(), 'atelier-projets-test-'))
  const databaseFile = path.join(dir, 'test.db')
  await applyMigrations(databaseFile)
  const prisma = createPrismaClient(`file:${databaseFile}`)
  const demoProjectId = seed ? await seedDemoProject(prisma) : 0
  const app = await buildApp({ prisma, logger: false, timeZone: 'Europe/Paris', ...options })
  return {
    app,
    prisma,
    demoProjectId,
    async close() {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/** Appel JSON ; renvoie le statut et le corps décodé. */
export async function call<T = any>(
  app: App,
  method: InjectOptions['method'],
  url: string,
  payload?: unknown,
): Promise<{ status: number; body: T; response: LightMyRequestResponse }> {
  const response = await app.inject({ method, url, ...(payload !== undefined && { payload: payload as object }) })
  const body = response.body === '' ? undefined : response.json()
  return { status: response.statusCode, body: body as T, response }
}
