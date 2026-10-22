// Manifeste du nœud Atelier Projets (docs/SUITE.md §7.1) : une entrée par action, avec les schémas TypeBox
// de sa route. routes/atelier.ts enregistre chaque route à partir de la même déclaration : le manifeste ne peut
// pas décrire une entrée différente de celle que la route valide.
import type { TSchema } from 'typebox'
import {
  AtelierTableSchema,
  DataflowInputSchema,
  EVENT_DATA_SCHEMAS,
  EVENT_LABELS,
  MilestoneIdParams,
  NodeImportOutput,
  NodeLogEntryOutput,
  NodeLogEntrySchema,
  NodeMilestoneOutput,
  NodeMilestoneReachSchema,
  NodeProjectsOutput,
  NodeTimeEntryOutput,
  NodeTimeEntrySchema,
  NodeTreeOutput,
  NodeWorkItemCreateSchema,
  NodeWorkItemOutput,
  NodeWorkItemUpdateSchema,
  NODE_CONTRACT,
  ProjectIdParams,
  StoryIdParams,
  TableParams,
  TableQuery,
  WorkItemIdParams,
  WorkItemsQuery,
  type ManifestDto,
  type ProjetsEventType,
} from '../schemas/atelier.ts'

export type ActionKind = 'read' | 'write' | 'destructive'
export type Idempotency = 'header' | 'field' | 'natural' | 'none'
export type HttpMethod = 'GET' | 'POST' | 'PATCH'

export interface NodeActionSpec {
  id: string
  label: string
  description: string
  kind: ActionKind
  method: HttpMethod
  /** Chemin du manifeste (paramètres {snake_case}), relatif à l'origine de l'API. */
  path: string
  params?: TSchema
  querystring?: TSchema
  body?: TSchema
  output: { format: 'atelier-table/1' | 'json'; schema: TSchema }
  idempotency: Idempotency
}

/** Actions de Projets utiles à un workflow (id stables : un renommage = nouvelle action). */
export const NODE_ACTIONS: readonly NodeActionSpec[] = [
  {
    id: 'projects.list',
    label: 'Lister les projets',
    description: 'Projets d’Atelier Projets avec leur budget, leurs dates et leur dépôt.',
    kind: 'read',
    method: 'GET',
    path: '/api/atelier/projects',
    output: { format: 'json', schema: NodeProjectsOutput },
    idempotency: 'none',
  },
  {
    id: 'projects.tree',
    label: 'Arborescence d’un projet',
    description: 'Phases, epics, stories et éléments d’un projet, avec agrégats, jalons et dépendances.',
    kind: 'read',
    method: 'GET',
    path: '/api/atelier/projects/{project_id}/tree',
    params: ProjectIdParams,
    output: { format: 'json', schema: NodeTreeOutput },
    idempotency: 'none',
  },
  {
    id: 'work_items.list',
    label: 'Lister les éléments d’un projet',
    description: 'Éléments (FEATURE, TASK, BUG) filtrés par statut, type, story, recherche ou date de modification.',
    kind: 'read',
    method: 'GET',
    path: '/api/atelier/projects/{project_id}/work-items',
    params: ProjectIdParams,
    querystring: WorkItemsQuery,
    output: { format: 'atelier-table/1', schema: AtelierTableSchema },
    idempotency: 'none',
  },
  {
    id: 'work_items.get',
    label: 'Lire un élément',
    description: 'Fiche complète d’un élément : description, journal, temps, commits et dépendances.',
    kind: 'read',
    method: 'GET',
    path: '/api/atelier/work-items/{work_item_id}',
    params: WorkItemIdParams,
    output: { format: 'json', schema: NodeWorkItemOutput },
    idempotency: 'none',
  },
  {
    id: 'work_items.create',
    label: 'Créer un élément',
    description: 'Crée une FEATURE, une TASK ou un BUG en fin de story.',
    kind: 'write',
    method: 'POST',
    path: '/api/atelier/stories/{story_id}/work-items',
    params: StoryIdParams,
    body: NodeWorkItemCreateSchema,
    output: { format: 'json', schema: NodeWorkItemOutput },
    idempotency: 'header',
  },
  {
    id: 'work_items.update',
    label: 'Modifier un élément',
    description: 'Change le statut, l’avancement, la priorité, l’échéance ou le titre d’un élément.',
    kind: 'write',
    method: 'PATCH',
    path: '/api/atelier/work-items/{work_item_id}',
    params: WorkItemIdParams,
    body: NodeWorkItemUpdateSchema,
    output: { format: 'json', schema: NodeWorkItemOutput },
    idempotency: 'natural',
  },
  {
    id: 'work_items.log',
    label: 'Écrire dans le journal d’avancement',
    description: 'Ajoute une entrée horodatée en fin de journal d’avancement d’un élément.',
    kind: 'write',
    method: 'POST',
    path: '/api/atelier/work-items/{work_item_id}/log-entries',
    params: WorkItemIdParams,
    body: NodeLogEntrySchema,
    output: { format: 'json', schema: NodeLogEntryOutput },
    idempotency: 'header',
  },
  {
    id: 'time_entries.create',
    label: 'Saisir du temps',
    description: 'Saisit des heures passées sur un élément (date du jour par défaut).',
    kind: 'write',
    method: 'POST',
    path: '/api/atelier/work-items/{work_item_id}/time-entries',
    params: WorkItemIdParams,
    body: NodeTimeEntrySchema,
    output: { format: 'json', schema: NodeTimeEntryOutput },
    idempotency: 'header',
  },
  {
    id: 'milestones.list',
    label: 'Lister les jalons d’un projet',
    description: 'Jalons d’un projet : phase, date cible et atteinte.',
    kind: 'read',
    method: 'GET',
    path: '/api/atelier/projects/{project_id}/milestones',
    params: ProjectIdParams,
    output: { format: 'atelier-table/1', schema: AtelierTableSchema },
    idempotency: 'none',
  },
  {
    id: 'milestones.reach',
    label: 'Marquer un jalon atteint',
    description: 'Pose la date d’atteinte d’un jalon (maintenant par défaut) ; sans effet s’il est déjà atteint.',
    kind: 'write',
    method: 'POST',
    path: '/api/atelier/milestones/{milestone_id}/reach',
    params: MilestoneIdParams,
    body: NodeMilestoneReachSchema,
    output: { format: 'json', schema: NodeMilestoneOutput },
    idempotency: 'natural',
  },
  {
    id: 'tables.get',
    label: 'Lire une table de Projets',
    description: 'Éléments de travail, saisies de temps ou jalons (tous les projets ou un seul) au format atelier-table/1.',
    kind: 'read',
    method: 'GET',
    path: '/api/atelier/tables/{name}',
    params: TableParams,
    querystring: TableQuery,
    output: { format: 'atelier-table/1', schema: AtelierTableSchema },
    idempotency: 'none',
  },
  {
    id: 'imports.atelier_tab',
    label: 'Importer une table d’Atelier Tab',
    description: 'Importe une enveloppe DataFlow v2.1.0 : crée ou met à jour les éléments (réimport sans doublon).',
    kind: 'write',
    method: 'POST',
    path: '/api/imports/atelier-tab',
    body: DataflowInputSchema,
    output: { format: 'json', schema: NodeImportOutput },
    idempotency: 'header',
  },
]

type JsonSchema = Record<string, unknown>

/** Schéma TypeBox → objet JSON simple (sans métadonnées internes). */
const plain = (schema: TSchema | undefined): JsonSchema => (schema === undefined ? {} : (JSON.parse(JSON.stringify(schema)) as JsonSchema))

/**
 * input_schema d'une action (JSON Schema 2020-12) : propriétés du chemin, de la requête et du corps réunies,
 * obligatoires si elles le sont dans leur partie. Les propriétés de path vont dans le chemin, celles d'un GET
 * dans la requête, les autres dans le corps (§7.1).
 */
export function inputSchema(action: NodeActionSpec): JsonSchema {
  const parts = [action.params, action.querystring, action.body].map(plain)
  const properties: JsonSchema = {}
  const required: string[] = []
  for (const part of parts) {
    Object.assign(properties, (part.properties as JsonSchema | undefined) ?? {})
    required.push(...((part.required as string[] | undefined) ?? []))
  }
  const body = parts[2] ?? {}
  // Corps libre (enveloppe DataFlow) : décrit tel quel.
  if (action.body !== undefined && body.properties === undefined) return { ...body, type: 'object' }
  return {
    type: 'object',
    properties,
    required: [...new Set(required)],
    additionalProperties: false,
  }
}

export function buildManifest(version: string): ManifestDto {
  return {
    contract: NODE_CONTRACT,
    app: 'projets',
    name: 'Atelier Projets',
    version,
    transport: 'http',
    actions: NODE_ACTIONS.map((action) => ({
      id: action.id,
      label: action.label,
      description: action.description,
      kind: action.kind,
      http: { method: action.method, path: action.path },
      mcp_tool: null,
      input_schema: inputSchema(action),
      output: { format: action.output.format, schema: plain(action.output.schema) },
      idempotency: action.idempotency,
    })),
    events: (Object.keys(EVENT_DATA_SCHEMAS) as ProjetsEventType[]).map((type) => ({
      type,
      label: EVENT_LABELS[type],
      data_schema: plain(EVENT_DATA_SCHEMAS[type]),
    })),
  }
}

/** Action par identifiant (routes). */
export function nodeAction(id: string): NodeActionSpec {
  const action = NODE_ACTIONS.find((candidate) => candidate.id === id)
  if (!action) throw new Error(`Action inconnue du manifeste : ${id}`)
  return action
}

/** Chemin Fastify d'une action (« {project_id} » → « :project_id »), sans le préfixe /api. */
export function fastifyPath(action: NodeActionSpec): string {
  return action.path.replace(/^\/api/, '').replace(/\{([a-z_]+)\}/g, ':$1')
}
