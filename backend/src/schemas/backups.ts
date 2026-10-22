// Sauvegardes de la base SQLite.
import { Type, type Static } from 'typebox'
import { DateTime } from './common.ts'

export const BackupSchema = Type.Object({
  name: Type.String(),
  size: Type.Integer({ description: 'Taille en octets' }),
  createdAt: DateTime,
  reason: Type.Enum(['auto', 'manual', 'migration'], {
    type: 'string',
    description: 'auto : au démarrage puis toutes les 24 h · manual : « Sauvegarder maintenant » · migration : avant l’application de migrations',
  }),
})
export type BackupDto = Static<typeof BackupSchema>

export const BackupListSchema = Type.Object(
  {
    enabled: Type.Boolean({ description: 'false : base en mémoire ou sauvegardes désactivées' }),
    dir: Type.String(),
    keep: Type.Integer({ description: 'Sauvegardes conservées de chaque sorte, automatique, manuelle et avant migration (BACKUP_KEEP)' }),
    backups: Type.Array(BackupSchema, { description: 'Les plus récentes d’abord' }),
  },
  { description: 'Sauvegardes de la base SQLite' },
)
export type BackupListDto = Static<typeof BackupListSchema>

export const BackupParams = Type.Object({ name: Type.String({ pattern: '^atelier-[0-9T-]+-(auto|manual|migration)\\.db$' }) })
