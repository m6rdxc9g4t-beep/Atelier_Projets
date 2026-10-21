// Réglages globaux de l'application, gardés dans la base (table AppSetting, une ligne par clé, valeur JSON).
// Aujourd'hui : le mode hors ligne / en ligne (docs/SUITE.md §5.1), hors ligne par défaut.
import type { Db } from '../db/client.ts'
import type { AppSettingsDto, AppSettingsUpdate } from '../schemas/settings.ts'

const ONLINE_MODE = 'onlineMode'

/** Message du refus d'un appel à Claude hors ligne (HTTP 403). */
export const OFFLINE_MESSAGE = 'Mode hors ligne : rien ne part vers Claude. Activer le mode « En ligne » (en-tête) pour l’utiliser.'

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'boolean' ? value : undefined
  } catch {
    return undefined
  }
}

/** Mode en ligne : true seulement si l'utilisateur l'a activé (valeur absente ou illisible = hors ligne). */
export async function isOnline(prisma: Db): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: ONLINE_MODE } })
  return parseBoolean(row?.value) ?? false
}

export async function getSettings(prisma: Db): Promise<AppSettingsDto> {
  return { onlineMode: await isOnline(prisma) }
}

export async function updateSettings(prisma: Db, input: AppSettingsUpdate): Promise<AppSettingsDto> {
  if (input.onlineMode !== undefined) {
    const value = JSON.stringify(input.onlineMode)
    await prisma.appSetting.upsert({ where: { key: ONLINE_MODE }, create: { key: ONLINE_MODE, value }, update: { value } })
  }
  return getSettings(prisma)
}
