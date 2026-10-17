// Configuration du CLI Prisma 7 (generate, migrate, db seed, studio).
// Prisma 7 ne lit plus .env tout seul : on le charge ici, puis on résout l'URL SQLite
// depuis le dossier backend/ (même règle que le serveur et le seed, voir src/config.ts).
import { defineConfig } from 'prisma/config'
import { loadEnvFile, resolveDatabaseUrl } from './src/config.ts'

loadEnvFile()

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: resolveDatabaseUrl(process.env.DATABASE_URL),
  },
})
