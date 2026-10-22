// Sauvegarde avant migration (docs/SUITE.md §8.2) : détection des migrations en attente sans le moteur Prisma,
// copie seulement quand il y a quelque chose à appliquer sur une base existante.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'
import { BACKEND_ROOT } from '../src/config.ts'
import { BackupManager } from '../src/services/backups.ts'
import { appliedMigrations, backupBeforeMigrations, localMigrations, pendingMigrations } from '../src/services/pending-migrations.ts'

const run = promisify(execFile)

describe('sauvegarde avant migration', () => {
  let dir: string
  let migrationsDir: string
  let databaseFile: string

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'atelier-premigration-'))
    migrationsDir = path.join(dir, 'migrations')
    for (const name of ['20260101000000_init', '20260201000000_suite', '20260301000000_nouvelle']) {
      await mkdir(path.join(migrationsDir, name), { recursive: true })
      await writeFile(path.join(migrationsDir, name, 'migration.sql'), '-- sql')
    }
    await mkdir(path.join(migrationsDir, 'brouillon'))
    await writeFile(path.join(migrationsDir, 'migration_lock.toml'), 'provider = "sqlite"')
    databaseFile = path.join(dir, 'dev.db')
  })
  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function writeApplied(rows: { name: string; finished: boolean; rolledBack?: boolean }[]): void {
    const db = new Database(databaseFile)
    db.exec(`DROP TABLE IF EXISTS _prisma_migrations;
      CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, finished_at DATETIME, migration_name TEXT NOT NULL,
        logs TEXT, rolled_back_at DATETIME, started_at DATETIME NOT NULL DEFAULT current_timestamp, applied_steps_count INTEGER NOT NULL DEFAULT 0);
      DROP TABLE IF EXISTS Projet; CREATE TABLE Projet (id INTEGER PRIMARY KEY, nom TEXT); INSERT INTO Projet (nom) VALUES ('Démo');`)
    const insert = db.prepare('INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, rolled_back_at) VALUES (?, ?, ?, ?, ?)')
    rows.forEach((row, index) => insert.run(String(index), 'x', row.finished ? '2026-01-01' : null, row.name, row.rolledBack ? '2026-01-02' : null))
    db.close()
  }

  it('liste les migrations du dépôt (dossiers avec migration.sql, dans l’ordre)', async () => {
    assert.deepEqual(await localMigrations(migrationsDir), ['20260101000000_init', '20260201000000_suite', '20260301000000_nouvelle'])
    assert.deepEqual(await localMigrations(path.join(dir, 'absent')), [])
  })

  it('suit la règle de Prisma : appliquée = terminée et non annulée', async () => {
    assert.equal(appliedMigrations(databaseFile), null)
    writeApplied([
      { name: '20260101000000_init', finished: true },
      { name: '20260201000000_suite', finished: true, rolledBack: true },
      { name: '20260301000000_nouvelle', finished: false },
    ])
    assert.deepEqual(appliedMigrations(databaseFile), ['20260101000000_init'])
    assert.deepEqual(await pendingMigrations({ databaseFile, migrationsDir }), ['20260201000000_suite', '20260301000000_nouvelle'])
  })

  it('ne copie rien quand tout est appliqué, copie (sorte « migration ») sinon', async () => {
    const backups = new BackupManager({ databaseFile, dir: path.join(dir, 'backups'), keep: 3 })
    writeApplied(['20260101000000_init', '20260201000000_suite', '20260301000000_nouvelle'].map((name) => ({ name, finished: true })))
    assert.deepEqual(await backupBeforeMigrations({ databaseFile, migrationsDir, backups }), { status: 'up-to-date', pending: [] })
    assert.deepEqual(await backups.list(), [])

    writeApplied([{ name: '20260101000000_init', finished: true }])
    const result = await backupBeforeMigrations({ databaseFile, migrationsDir, backups })
    assert.equal(result.status, 'saved')
    assert.ok(result.status === 'saved')
    assert.match(result.backup.name, /^atelier-.*-migration\.db$/)
    assert.equal(result.backup.reason, 'migration')
    const copy = new Database(path.join(dir, 'backups', result.backup.name), { readonly: true })
    assert.deepEqual(copy.prepare('SELECT nom FROM Projet').all(), [{ nom: 'Démo' }])
    copy.close()
    assert.ok(await backups.file(result.backup.name))

    assert.deepEqual(await backupBeforeMigrations({ databaseFile, migrationsDir, backups: null }), {
      status: 'disabled',
      pending: ['20260201000000_suite', '20260301000000_nouvelle'],
    })
  })

  it('ne copie pas une base qui n’existe pas encore', async () => {
    const backups = new BackupManager({ databaseFile: path.join(dir, 'neuve.db'), dir: path.join(dir, 'neuves'), keep: 3 })
    const result = await backupBeforeMigrations({ databaseFile: path.join(dir, 'neuve.db'), migrationsDir, backups })
    assert.equal(result.status, 'new-database')
    assert.equal(existsSync(path.join(dir, 'neuves')), false)
  })

  it('le script npm (predb:deploy) copie la base puis rend la main, et échoue si la copie est impossible', async () => {
    const env = { ...process.env, DATABASE_URL: `file:${databaseFile}`, BACKUP_DIR: path.join(dir, 'script'), BACKUP_KEEP: '2' }
    writeApplied([{ name: '20260101000000_init', finished: true }])
    // Migrations réelles du dépôt : la base de test n'en a appliqué aucune.
    const { stdout } = await run(process.execPath, ['--import', 'tsx', 'scripts/backup-before-migrate.ts'], { cwd: BACKEND_ROOT, env })
    assert.match(stdout, /Sauvegarde avant migration : .*-migration\.db \(migrations en attente : /)
    assert.equal((await readdir(path.join(dir, 'script'))).length, 1)

    await writeFile(path.join(dir, 'pas-une-base.db'), 'ceci n’est pas une base SQLite')
    await assert.rejects(
      run(process.execPath, ['--import', 'tsx', 'scripts/backup-before-migrate.ts'], {
        cwd: BACKEND_ROOT,
        env: { ...env, DATABASE_URL: `file:${path.join(dir, 'pas-une-base.db')}` },
      }),
      (error: { code?: number; stderr?: string }) => error.code === 1 && /Sauvegarde de la base impossible/.test(error.stderr ?? ''),
    )
  })
})
