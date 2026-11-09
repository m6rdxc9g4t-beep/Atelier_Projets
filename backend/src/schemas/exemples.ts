// Exemples de la suite : histoires fictives qui traversent toutes les apps (format atelier-exemples/1).
import { Type, type Static } from 'typebox'

export const ExempleEtapeSchema = Type.Object({
  app: Type.String({ description: 'convert, tab, viz, tresorerie, nexus, projets ou wiki' }),
  titre: Type.String(),
  texte: Type.String(),
})

export const ExempleHistoireSchema = Type.Object(
  {
    id: Type.String(),
    titre: Type.String(),
    sous_titre: Type.String(),
    secteur: Type.String(),
    resume: Type.String(),
    parcours: Type.Array(ExempleEtapeSchema),
    projet: Type.String({ description: 'Nom du projet que l’exemple crée' }),
    elements: Type.Integer(),
    jalons: Type.Integer(),
    charge: Type.Boolean(),
    projectId: Type.Union([Type.Integer(), Type.Null()]),
  },
  { description: 'Histoire d’exemple et ce qu’elle crée dans Projets' },
)
export type ExempleHistoireDto = Static<typeof ExempleHistoireSchema>

export const ExempleChargeSchema = Type.Object({
  histoire: Type.String(),
  projectId: Type.Integer(),
  dejaCharge: Type.Boolean(),
  /** Story qui reçoit la tâche née de l'alerte de Viz (null si l'exemple était déjà chargé). */
  storyAlerteId: Type.Union([Type.Integer(), Type.Null()]),
})
export type ExempleChargeDto = Static<typeof ExempleChargeSchema>

export const ExempleParams = Type.Object({ histoire: Type.String({ pattern: '^[a-z0-9][a-z0-9-]{0,63}$' }) })
