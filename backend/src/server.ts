// Point d'entrée : configuration → base SQLite → API Fastify (127.0.0.1:3000 par défaut).
import path from 'node:path'
import { buildApp } from './app.ts'
import { BACKEND_ROOT, loadConfig, loadEnvFile } from './config.ts'
import { createPrismaClient } from './db/client.ts'
import { createClaudeLauncher } from './ai-bridge/claude-cli.ts'
import { createClaudeEngine } from './ai-bridge/claude-print.ts'
import { captureClaudeToken, claudePrivateHome, CLAUDE_TOKEN_ENV } from './ai-bridge/claude-token.ts'
import { createOllamaClient } from './ai-bridge/ollama.ts'
import { createOctokitClient } from './git-engine/github.ts'
import { BackupManager } from './services/backups.ts'
import { pendingMigrationsWarning } from './services/pending-migrations.ts'

// Jeton du forfait Claude (mode jeton, docs/SUITE.md §5.3) : lu une fois dans l'environnement du processus, puis
// retiré avant tout sous-processus (git, session Claude du terminal…). Jamais lu dans backend/.env.
const claudeToken = captureClaudeToken()
loadEnvFile()
const tokenInEnvFile = captureClaudeToken() !== null
const config = loadConfig()

// Fichier de la base (URL « file: » rendue absolue par la configuration) : sauvegardé sauf BACKUP_KEEP=0.
const databaseFile = config.databaseUrl.slice('file:'.length).split('?')[0] || null
// Dossier privé de la CLI en mode jeton : à côté de la base (dossier de données de l'application).
const claudeHome = claudePrivateHome(databaseFile ? path.dirname(databaseFile) : path.join(BACKEND_ROOT, 'prisma'))
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
  exemplesDir: config.exemplesDir,
  ai: {
    ollama: createOllamaClient({ baseUrl: config.ollamaUrl, timeoutMs: config.ollamaTimeoutMs, contextTokens: config.ollamaContextTokens }),
    model: config.ollamaModel,
    maxDiffChars: config.aiMaxDiffChars,
    claude: createClaudeLauncher({ command: config.claudeCli, terminalApp: config.claudeTerminalApp }),
    claudeEngine: createClaudeEngine({
      command: config.claudeCli,
      timeoutMs: config.claudeTimeoutMs,
      ...(claudeToken && { token: claudeToken, privateHome: claudeHome }),
    }),
  },
})

if (claudeToken) app.log.info(`Claude : forfait par jeton (${CLAUDE_TOKEN_ENV}), CLI isolée, dossier privé ${claudeHome}`)
if (tokenInEnvFile) app.log.warn(`${CLAUDE_TOKEN_ENV} ignoré dans backend/.env : le fournir par l’environnement du processus (Docker : environment)`)

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

// Lancement en terminal après un « git pull », base remplacée par une sauvegarde plus ancienne : le dire tout de suite
// (l'app de bureau et Docker appliquent les migrations avant de lancer l'API). L'API démarre quand même.
if (databaseFile) {
  const warning = await pendingMigrationsWarning({ databaseFile, migrationsDir: path.join(BACKEND_ROOT, 'prisma', 'migrations') })
  if (warning) app.log.error(warning)
}

try {
  await app.listen({ host: config.host, port: config.port })
  backups?.startAutomatic((error) => app.log.error({ err: error }, 'Sauvegarde automatique impossible'))
  app.log.info(`Documentation de l’API : http://${config.host}:${config.port}/api/docs`)
} catch (error) {
  app.log.error({ err: error }, 'Démarrage impossible')
  process.exit(1)
}
