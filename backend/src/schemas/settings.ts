// Réglages de l'application : mode hors ligne / en ligne (docs/SUITE.md §5.1).
import { Type, type Static } from 'typebox'
import { StrictObject } from './common.ts'

export const AppSettingsSchema = Type.Object(
  {
    onlineMode: Type.Boolean({
      description: 'En ligne : Claude peut être utilisé. Hors ligne (défaut) : rien ne part vers Claude, toute requête explicite est refusée (403).',
    }),
  },
  { description: 'Réglages de l’application' },
)
export type AppSettingsDto = Static<typeof AppSettingsSchema>

export const AppSettingsUpdateSchema = StrictObject({
  onlineMode: Type.Optional(Type.Boolean({ description: 'Activer (true) ou couper (false) le mode en ligne' })),
})
export type AppSettingsUpdate = Static<typeof AppSettingsUpdateSchema>
