// Migrations Prisma en attente sur une base SQLite, lues sans le moteur de Prisma : dossiers de prisma/migrations
// comparés à la table _prisma_migrations, avec la règle de Prisma (une migration est appliquée si elle est terminée
// et non annulée). Sert à sauvegarder la base avant « prisma migrate deploy », et seulement s'il y a quelque chose
// à appliquer (docs/SUITE.md §8.2).
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { BackupInfo, BackupManager } from './backups.ts'

/** Migrations du dépôt : sous-dossiers de `dir` qui contiennent un migration.sql, dans l'ordre d'application. */
export async function localMigrations(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, 'migration.sql')))
    .map((entry) => entry.name)
    .sort()
}

/**
 * Migrations appliquées à la base (lecture seule). null : la base n'existe pas encore (Prisma la créera) ;
 * [] : base sans table _prisma_migrations.
 */
export function appliedMigrations(databaseFile: string): string[] | null {
  if (!existsSync(databaseFile)) return null
  const db = new Database(databaseFile, { readonly: true, fileMustExist: true })
  try {
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'").get()
    if (!table) return []
    const rows = db
      .prepare('SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')
      .all() as { name: string }[]
    return rows.map((row) => row.name)
  } finally {
    db.close()
  }
}

/** Migrations du dépôt pas encore appliquées à la base (toutes si la base n'existe pas). */
export async function pendingMigrations(options: { databaseFile: string; migrationsDir: string }): Promise<string[]> {
  const local = await localMigrations(options.migrationsDir)
  const applied = new Set(appliedMigrations(options.databaseFile) ?? [])
  return local.filter((name) => !applied.has(name))
}

export type PreMigrationBackup =
  | { status: 'up-to-date'; pending: [] }
  | { status: 'new-database'; pending: string[] }
  | { status: 'disabled'; pending: string[] }
  | { status: 'saved'; pending: string[]; backup: BackupInfo }

/**
 * Copie de la base avant l'application de migrations, seulement s'il y en a en attente sur une base existante
 * et non vide. `backups` null : sauvegardes désactivées (BACKUP_KEEP=0) ou base en mémoire.
 * Une copie impossible rejette : les migrations ne doivent pas être appliquées sans elle.
 */
export async function backupBeforeMigrations(options: {
  databaseFile: string
  migrationsDir: string
  backups: BackupManager | null
}): Promise<PreMigrationBackup> {
  const pending = await pendingMigrations(options)
  if (pending.length === 0) return { status: 'up-to-date', pending: [] }
  const info = await stat(options.databaseFile).catch(() => null)
  if (!info || info.size === 0) return { status: 'new-database', pending }
  if (!options.backups) return { status: 'disabled', pending }
  return { status: 'saved', pending, backup: await options.backups.create('migration') }
}
