// Point d'entrée : configuration → base SQLite → API Fastify (127.0.0.1:3000 par défaut).
import { buildApp } from './app.ts'
import { loadConfig, loadEnvFile } from './config.ts'
import { createPrismaClient } from './db/client.ts'

loadEnvFile()
const config = loadConfig()

const app = await buildApp({
  prisma: createPrismaClient(config.databaseUrl),
  logger: { level: config.logLevel },
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
} catch (error) {
  app.log.error({ err: error }, 'Démarrage impossible')
  process.exit(1)
}
