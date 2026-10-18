// Sauvegardes de la base SQLite : copie cohérente à chaud (API « backup » de SQLite via better-sqlite3),
// automatique au démarrage puis toutes les 24 h, manuelle depuis l'interface ; les plus anciennes sont
// supprimées au-delà de BACKUP_KEEP (pour chaque sorte, automatique ou manuelle). Restauration : arrêter l'application et remplacer le fichier de la base.
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import Database from 'better-sqlite3'

export type BackupReason = 'auto' | 'manual'

export interface BackupInfo {
  name: string
  size: number
  createdAt: string
  reason: BackupReason
}

const NAME = /^atelier-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?-(auto|manual)\.db$/
const DAY_MS = 86_400_000

export function isBackupName(name: string): boolean {
  return NAME.test(name)
}

function parseName(name: string): { createdAt: Date; reason: BackupReason } | null {
  const match = NAME.exec(name)
  if (!match) return null
  const [, y, mo, d, h, mi, s, ms, reason] = match
  return { createdAt: new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}.${ms ?? '000'}Z`), reason: reason as BackupReason }
}

export interface BackupManagerOptions {
  /** Fichier SQLite à sauvegarder. */
  databaseFile: string
  /** Dossier des sauvegardes. */
  dir: string
  /** Sauvegardes conservées (les plus récentes). */
  keep: number
  now?: () => Date
}

export class BackupManager {
  readonly dir: string
  readonly keep: number
  private readonly databaseFile: string
  private readonly now: () => Date
  private timer: NodeJS.Timeout | null = null
  private queue: Promise<unknown> | null = null

  constructor(options: BackupManagerOptions) {
    this.databaseFile = options.databaseFile
    this.dir = options.dir
    this.keep = Math.max(1, options.keep)
    this.now = options.now ?? (() => new Date())
  }

  async list(): Promise<BackupInfo[]> {
    const names = await readdir(this.dir).catch(() => [] as string[])
    const backups: BackupInfo[] = []
    for (const name of names) {
      const parsed = parseName(name)
      if (!parsed) continue
      const info = await stat(path.join(this.dir, name)).catch(() => null)
      if (info?.isFile()) backups.push({ name, size: info.size, createdAt: parsed.createdAt.toISOString(), reason: parsed.reason })
    }
    return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name))
  }

  /** Copie cohérente de la base, même pendant des écritures ; les sauvegardes s'enchaînent une à une. */
  create(reason: BackupReason): Promise<BackupInfo> {
    const next = (this.queue ?? Promise.resolve()).then(() => this.doCreate(reason))
    this.queue = next.catch(() => undefined)
    return next
  }

  private async doCreate(reason: BackupReason): Promise<BackupInfo> {
    await mkdir(this.dir, { recursive: true })
    const stamp = this.now().toISOString().replace(/:/g, '-').replace('.', '-').replace(/Z$/, '')
    const name = `atelier-${stamp}-${reason}.db`
    const target = path.join(this.dir, name)
    // Copie dans un fichier temporaire puis renommage : une copie interrompue n'est jamais listée.
    const partial = `${target}.partial`
    const source = new Database(this.databaseFile, { readonly: true, fileMustExist: true })
    try {
      await source.backup(partial)
      await rename(partial, target)
    } catch (error) {
      await rm(partial, { force: true })
      throw error
    } finally {
      source.close()
    }
    await this.prune()
    const info = await stat(target)
    return { name, size: info.size, createdAt: (parseName(name)?.createdAt ?? this.now()).toISOString(), reason }
  }

  /** Chemin d'une sauvegarde existante (nom validé), sinon null. */
  async file(name: string): Promise<string | null> {
    if (!isBackupName(name)) return null
    const file = path.join(this.dir, name)
    const info = await stat(file).catch(() => null)
    return info?.isFile() ? file : null
  }

  /** Garde les `keep` plus récentes de chaque sorte : les copies manuelles ne sont pas chassées par les automatiques. */
  private async prune(): Promise<void> {
    const backups = await this.list()
    for (const reason of ['auto', 'manual'] as const) {
      for (const backup of backups.filter((candidate) => candidate.reason === reason).slice(this.keep)) {
        await rm(path.join(this.dir, backup.name), { force: true })
      }
    }
  }

  /** Sauvegarde automatique si la dernière date de plus de 24 h, vérifiée maintenant puis toutes les heures. */
  startAutomatic(onError: (error: unknown) => void): void {
    const check = async () => {
      try {
        const [latest] = await this.list()
        if (!latest || this.now().getTime() - Date.parse(latest.createdAt) >= DAY_MS) await this.create('auto')
      } catch (error) {
        onError(error)
      }
    }
    void check()
    this.timer = setInterval(() => void check(), 3_600_000)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
