// IA locale (Ollama) et Claude CLI : état, découpage d'une Story, résumé des commits, session Claude.
import { Type, type Static } from 'typebox'
import { CLAUDE_PERMISSION_MODES } from '../ai-bridge/claude-cli.ts'
import { ContainerRefSchema, DurationSchema, Id, Nullable, StrictObject } from './common.ts'

const ModelName = Type.String({ minLength: 1, maxLength: 200, pattern: '\\S', description: 'Modèle Ollama (défaut : OLLAMA_MODEL)' })

export const AiStatusSchema = Type.Object(
  {
    ollama: Type.Object({
      url: Type.String(),
      reachable: Type.Boolean(),
      error: Nullable(Type.String()),
      defaultModel: Type.String(),
      defaultModelInstalled: Type.Boolean(),
      defaultModelName: Nullable(Type.String({ description: 'Étiquette installée utilisée pour le modèle par défaut (ex. qwen2.5-coder:7b)' })),
      models: Type.Array(
        Type.Object({
          name: Type.String(),
          size: Type.Number({ description: 'Taille sur le disque, en octets' }),
          parameterSize: Nullable(Type.String()),
          family: Nullable(Type.String()),
        }),
      ),
    }),
    claude: Type.Object({
      available: Type.Boolean(),
      version: Nullable(Type.String()),
      command: Type.String(),
      canOpenTerminal: Type.Boolean({ description: 'Ouverture automatique d’un terminal (macOS)' }),
      terminalApp: Nullable(Type.String()),
      error: Nullable(Type.String()),
    }),
  },
  { description: 'État de l’IA locale (Ollama) et de Claude CLI' },
)
export type AiStatusDto = Static<typeof AiStatusSchema>

export const BreakdownRequestSchema = StrictObject({
  storyId: Id,
  model: Type.Optional(ModelName),
  instructions: Type.Optional(Type.String({ maxLength: 2000, description: 'Consignes complémentaires pour le découpage' })),
})
export type BreakdownRequest = Static<typeof BreakdownRequestSchema>

export const BreakdownResultSchema = Type.Object(
  {
    story: ContainerRefSchema,
    model: Type.String(),
    hoursPerDay: Type.Number(),
    items: Type.Array(
      Type.Object({
        type: Type.Enum(['FEATURE', 'TASK'], { type: 'string' }),
        title: Type.String(),
        description: Type.String({ description: 'Objectif et critères d’acceptation (Markdown)' }),
        estimate: DurationSchema,
      }),
    ),
  },
  { description: 'Propositions de Features et Tasks (rien n’est enregistré : à créer avec POST /stories/:storyId/work-items/batch)' },
)
export type BreakdownResultDto = Static<typeof BreakdownResultSchema>

export const SummarizeRequestSchema = StrictObject({
  workItemId: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }),
  model: Type.Optional(ModelName),
})
export type SummarizeRequest = Static<typeof SummarizeRequestSchema>

export const SummarizeResultSchema = Type.Object(
  {
    workItemId: Type.Integer(),
    model: Type.String(),
    text: Type.String({ description: 'Entrée proposée pour le journal d’avancement (Markdown) — rien n’est enregistré' }),
    commits: Type.Array(
      Type.Object({
        shortHash: Type.String(),
        subject: Type.String(),
        diff: Type.Enum(['full', 'truncated', 'missing'], { type: 'string', description: 'Diff transmis au modèle' }),
      }),
    ),
    warnings: Type.Array(Type.String()),
  },
  { description: 'Résumé des commits liés à un élément, rédigé par l’IA locale' },
)
export type SummarizeResultDto = Static<typeof SummarizeResultSchema>

const PermissionMode = Type.Enum(CLAUDE_PERMISSION_MODES, {
  type: 'string',
  description: 'Mode de permission de la session : default (demande avant d’agir), plan (plan d’abord), acceptEdits',
})

export const ClaudePromptQuery = Type.Object({ workItemId: Type.Integer({ minimum: 1, maximum: 2_147_483_647 }) })

export const ClaudePromptSchema = Type.Object(
  {
    workItemId: Type.Integer(),
    prompt: Type.String({ description: 'Prompt initial proposé pour la session Claude CLI' }),
    cwd: Nullable(Type.String({ description: 'Dépôt Git local du projet (dossier de la session) ; null s’il n’est pas renseigné' })),
  },
  { description: 'Aperçu du prompt d’une session Claude CLI' },
)
export type ClaudePromptDto = Static<typeof ClaudePromptSchema>

export const ClaudeLaunchRequestSchema = StrictObject({
  workItemId: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_147_483_647, description: 'Élément : la session démarre avec son prompt' })),
  projectId: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_147_483_647, description: 'Sans élément : session interactive dans le dépôt du projet' })),
  permissionMode: Type.Optional(PermissionMode),
  prompt: Type.Optional(Type.String({ minLength: 1, maxLength: 50_000, pattern: '\\S', description: 'Prompt modifié (défaut : celui de l’aperçu)' })),
})
export type ClaudeLaunchRequest = Static<typeof ClaudeLaunchRequestSchema>

export const ClaudeLaunchResultSchema = Type.Object(
  {
    launched: Type.Boolean({ description: 'true : session ouverte dans le terminal (macOS) ; false : commande à copier' }),
    command: Type.String({ description: 'Commande qui ouvre la session dans le dépôt' }),
    promptFile: Nullable(Type.String()),
  },
  { description: 'Session Claude CLI préparée ou ouverte' },
)
export type ClaudeLaunchResultDto = Static<typeof ClaudeLaunchResultSchema>
