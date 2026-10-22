// Sauvegarde la base avant « prisma migrate deploy » quand des migrations sont en attente (docs/SUITE.md §8.2).
// Lancé automatiquement avant « npm run db:deploy » (script npm predb:deploy) : par l'application de bureau au
// lancement qui suit un « git pull », par « npm run setup », ou à la main. Code de sortie non nul si la copie
// échoue : npm n'applique alors pas les migrations.
import path from 'node:path'
import { BACKEND_ROOT, loadConfig, loadEnvFile } from '../src/config.ts'
import { BackupManager } from '../src/services/backups.ts'
import { backupBeforeMigrations } from '../src/services/pending-migrations.ts'

loadEnvFile()
const config = loadConfig()
// Même règle que src/server.ts : URL « file: » rendue absolue par la configuration.
const databaseFile = config.databaseUrl.slice('file:'.length).split('?')[0] ?? ''

if (!databaseFile || path.basename(databaseFile) === ':memory:') {
  console.log('Sauvegarde avant migration : base en mémoire, rien à copier.')
} else {
  const backups = config.backupKeep > 0 ? new BackupManager({ databaseFile, dir: config.backupDir, keep: config.backupKeep }) : null
  try {
    const result = await backupBeforeMigrations({ databaseFile, migrationsDir: path.join(BACKEND_ROOT, 'prisma', 'migrations'), backups })
    const list = result.pending.join(', ')
    if (result.status === 'up-to-date') console.log('Sauvegarde avant migration : aucune migration en attente, pas de copie.')
    else if (result.status === 'new-database') console.log(`Sauvegarde avant migration : nouvelle base, rien à copier (${list}).`)
    else if (result.status === 'disabled') console.log(`Sauvegarde avant migration : sauvegardes désactivées (BACKUP_KEEP=0), migrations sans copie (${list}).`)
    else console.log(`Sauvegarde avant migration : ${path.join(config.backupDir, result.backup.name)} (migrations en attente : ${list}).`)
  } catch (error) {
    console.error(`✘ Sauvegarde de la base impossible avant les migrations : ${error instanceof Error ? error.message : String(error)}`)
    console.error('  Les migrations n’ont pas été appliquées.')
    process.exit(1)
  }
}
