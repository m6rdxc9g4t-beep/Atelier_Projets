// Point d'entrée : configuration → base SQLite → API Fastify (127.0.0.1:3000 par défaut).
import { buildApp } from './app.ts'
import { loadConfig, loadEnvFile } from './config.ts'
import { createPrismaClient } from './db/client.ts'
import { createClaudeLauncher } from './ai-bridge/claude-cli.ts'
import { createClaudeEngine } from './ai-bridge/claude-print.ts'
import { createOllamaClient } from './ai-bridge/ollama.ts'
import { createOctokitClient } from './git-engine/github.ts'
import { BackupManager } from './services/backups.ts'

loadEnvFile()
const config = loadConfig()

// Fichier de la base (URL « file: » rendue absolue par la configuration) : sauvegardé sauf BACKUP_KEEP=0.
const databaseFile = config.databaseUrl.slice('file:'.length).split('?')[0] || null
const backups =
  databaseFile && config.backupKeep > 0 ? new BackupManager({ databaseFile, dir: config.backupDir, keep: config.backupKeep }) : null

const app = await buildApp({
  backups,
  prisma: createPrismaClient(config.databaseUrl),
  logger: { level: config.logLevel },
  timeZone: config.timeZone,
  publicUrl: config.publicUrl,
  gitScanMaxCommits: config.gitScanMaxCommits,
  github: createOctokitClient({ token: config.githubToken, baseUrl: config.githubApiUrl }),
  allowedHosts: config.allowedHosts,
  importToken: config.importToken,
  ai: {
    ollama: createOllamaClient({ baseUrl: config.ollamaUrl, timeoutMs: config.ollamaTimeoutMs, contextTokens: config.ollamaContextTokens }),
    model: config.ollamaModel,
    maxDiffChars: config.aiMaxDiffChars,
    claude: createClaudeLauncher({ command: config.claudeCli, terminalApp: config.claudeTerminalApp }),
    claudeEngine: createClaudeEngine({ command: config.claudeCli, timeoutMs: config.claudeTimeoutMs }),
  },
})

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, 'Arrêt du serveur')
  try {
    await app.close()
    process.exit(0)
  } catch (error) {
    app.log.error({ err: error }, 'Arrêt en erreur')
    process.exit(1)
  }
}

process.once('SIGINT', (signal) => void shutdown(signal))
process.once('SIGTERM', (signal) => void shutdown(signal))

try {
  await app.listen({ host: config.host, port: config.port })
  backups?.startAutomatic((error) => app.log.error({ err: error }, 'Sauvegarde automatique impossible'))
  app.log.info(`Documentation de l’API : http://${config.host}:${config.port}/api/docs`)
} catch (error) {
  app.log.error({ err: error }, 'Démarrage impossible')
  process.exit(1)
}
