// IA : état des moteurs (Ollama, Claude), découpage d'une Story, résumé des commits, session Claude CLI.
import { Type, type Static } from 'typebox'
import { CLAUDE_PERMISSION_MODES } from '../ai-bridge/claude-cli.ts'
import { CLAUDE_MODELS } from '../ai-bridge/claude-print.ts'
import { ContainerRefSchema, DurationSchema, Id, Nullable, StrictObject } from './common.ts'

const ModelName = Type.String({ minLength: 1, maxLength: 200, pattern: '\\S', description: 'Modèle Ollama (défaut : OLLAMA_MODEL)' })

/** Moteurs réellement utilisables. */
export const AI_ENGINES = ['ollama', 'claude'] as const
export type AiEngine = (typeof AI_ENGINES)[number]
/** Choix de l'utilisateur : Auto = Claude si en ligne et disponible, sinon Ollama (docs/SUITE.md §5.2). */
export const ENGINE_CHOICES = ['auto', 'ollama', 'claude'] as const
export type EngineChoice = (typeof ENGINE_CHOICES)[number]

const EngineChoiceSchema = Type.Enum(ENGINE_CHOICES, {
  type: 'string',
  description: 'Moteur : auto (Claude si en ligne et disponible, sinon Ollama), ollama, claude (refusé hors ligne : 403). Défaut : auto',
})
const EngineSchema = Type.Enum(AI_ENGINES, { type: 'string', description: 'Moteur qui a effectivement répondu' })
const ClaudeModelSchema = Type.Enum(CLAUDE_MODELS, { type: 'string', description: 'Modèle Claude (alias de la CLI). Défaut : sonnet' })

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
      available: Type.Boolean({ description: 'Moteur Claude utilisable maintenant : en ligne, CLI installée et connectée' }),
      installed: Type.Boolean({ description: 'CLI trouvée (CLAUDE_CLI, PATH, ~/.local/bin, /opt/homebrew/bin, /usr/local/bin)' }),
      loggedIn: Nullable(Type.Boolean({ description: '« claude auth status » (null : non vérifié, hors ligne ou CLI absente)' })),
      authMethod: Nullable(Type.String()),
      error: Nullable(Type.String({ description: 'Raison de l’indisponibilité du moteur, en français' })),
      warning: Nullable(Type.String({ description: 'Avertissement non bloquant (clé API au lieu de l’abonnement)' })),
      checkedAt: Nullable(Type.String({ description: 'Date de la dernière vérification de la connexion (cache 60 s)' })),
      models: Type.Array(ClaudeModelSchema),
      defaultModel: ClaudeModelSchema,
      timeoutMs: Type.Integer({ description: 'Délai maximal d’une réponse (CLAUDE_TIMEOUT_MS)' }),
      version: Nullable(Type.String()),
      command: Type.String({ description: 'Exécutable trouvé, ou la commande configurée' }),
      canOpenTerminal: Type.Boolean({ description: 'Ouverture automatique d’un terminal (macOS) pour une session interactive' }),
      terminalApp: Nullable(Type.String()),
    }),
    onlineMode: Type.Boolean({ description: 'Mode en ligne (Claude permis) ; hors ligne par défaut' }),
    auto: EngineSchema,
    maxDiffChars: Type.Integer({ description: 'Taille maximale cumulée des diffs transmis (AI_MAX_DIFF_CHARS)' }),
  },
  { description: 'État des moteurs d’IA (Ollama, Claude), du mode en ligne et du moteur retenu par « Auto »' },
)
export type AiStatusDto = Static<typeof AiStatusSchema>

export const AiStatusQuery = Type.Object({
  refresh: Type.Optional(Type.Boolean({ description: 'Revérifier la connexion de Claude (sinon cache de 60 s) ; au plus une revérification forcée toutes les 10 s' })),
})

export const BreakdownRequestSchema = StrictObject({
  storyId: Id,
  engine: Type.Optional(EngineChoiceSchema),
  model: Type.Optional(ModelName),
  claudeModel: Type.Optional(ClaudeModelSchema),
  instructions: Type.Optional(Type.String({ maxLength: 2000, description: 'Consignes complémentaires pour le découpage' })),
})
export type BreakdownRequest = Static<typeof BreakdownRequestSchema>

export const BreakdownResultSchema = Type.Object(
  {
    story: ContainerRefSchema,
    engine: EngineSchema,
    model: Type.String({ description: 'Modèle Ollama, ou alias du modèle Claude' }),
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
  engine: Type.Optional(EngineChoiceSchema),
  model: Type.Optional(ModelName),
  claudeModel: Type.Optional(ClaudeModelSchema),
})
export type SummarizeRequest = Static<typeof SummarizeRequestSchema>

export const SummarizeResultSchema = Type.Object(
  {
    workItemId: Type.Integer(),
    engine: EngineSchema,
    model: Type.String({ description: 'Modèle Ollama, ou alias du modèle Claude' }),
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
  { description: 'Résumé des commits liés à un élément, rédigé par Ollama ou Claude' },
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
