// API des tests de navigateur : base SQLite temporaire (migrations + projet de démo), IA locale injoignable,
// Claude CLI absente (session et moteur), sauvegardes dans le dossier temporaire. Rien n'est écrit dans backend/prisma.
// Port : E2E_API_PORT (3100 par défaut, pour ne pas gêner un « npm run dev » ouvert à côté).
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { seedDemoProject } from '../backend/prisma/demo-project.ts'
import { createClaudeLauncher } from '../backend/src/ai-bridge/claude-cli.ts'
import { createClaudeEngine } from '../backend/src/ai-bridge/claude-print.ts'
import { createOllamaClient } from '../backend/src/ai-bridge/ollama.ts'
import { buildApp } from '../backend/src/app.ts'
import { createPrismaClient } from '../backend/src/db/client.ts'
import { BackupManager } from '../backend/src/services/backups.ts'
import { applyMigrations } from '../backend/test/helpers/test-app.ts'

const port = Number(process.env.E2E_API_PORT ?? 3100)
const dir = await mkdtemp(path.join(tmpdir(), 'atelier-e2e-'))
const databaseFile = path.join(dir, 'e2e.db')
await applyMigrations(databaseFile)
const prisma = createPrismaClient(`file:${databaseFile}`)
await seedDemoProject(prisma)

const app = await buildApp({
  prisma,
  logger: { level: 'warn' },
  timeZone: 'Europe/Paris',
  publicUrl: `http://127.0.0.1:${port}`,
  backups: new BackupManager({ databaseFile, dir: path.join(dir, 'backups'), keep: 5 }),
  ai: {
    ollama: createOllamaClient({ baseUrl: 'http://127.0.0.1:9', timeoutMs: 2_000 }),
    claude: createClaudeLauncher({ command: path.join(dir, 'claude-absent') }),
    claudeEngine: createClaudeEngine({ command: path.join(dir, 'claude-absent') }),
  },
})

const shutdown = async () => {
  await app.close().catch(() => undefined)
  await rm(dir, { recursive: true, force: true })
  process.exit(0)
}
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())

await app.listen({ host: '127.0.0.1', port })
console.log(`API de test prête sur http://127.0.0.1:${port} (base ${databaseFile})`)
