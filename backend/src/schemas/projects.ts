import { Type, type Static } from 'typebox'
import { SLUG_PATTERN } from '../domain/slug.ts'
import {
  DateOnly,
  DateTime,
  Days,
  DurationSchema,
  Hours,
  HoursPerDay,
  Id,
  Markdown,
  Nullable,
  NullableInput,
  StrictObject,
  Title,
} from './common.ts'

const GITHUB_OWNER = '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'
const GITHUB_REPO = '^[A-Za-z0-9._-]{1,100}$'

export const ProjectSchema = Type.Object(
  {
    id: Id,
    name: Type.String(),
    slug: Type.String(),
    description: Type.String(),
    localRepoPath: Nullable(Type.String()),
    github: Nullable(Type.Object({ owner: Type.String(), repo: Type.String(), url: Type.String() })),
    defaultBranch: Type.String(),
    hoursPerDay: Type.Number(),
    budget: Nullable(DurationSchema),
    startDate: Nullable(DateOnly),
    dueDate: Nullable(DateOnly),
    gitScannedAt: Nullable(DateTime),
    githubSyncedAt: Nullable(DateTime),
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { description: 'Projet, lié à un dépôt Git local et à un dépôt GitHub' },
)
export type ProjectDto = Static<typeof ProjectSchema>

const slug = Type.String({ pattern: SLUG_PATTERN, maxLength: 60, description: 'Identifiant lisible, généré depuis le nom si absent' })

const projectFields = {
  description: Type.Optional(Markdown),
  localRepoPath: Type.Optional(
    NullableInput(Type.String({ minLength: 1, maxLength: 1000, description: 'Chemin absolu du dépôt Git local' })),
  ),
  githubOwner: Type.Optional(NullableInput(Type.String({ pattern: GITHUB_OWNER }))),
  githubRepo: Type.Optional(NullableInput(Type.String({ pattern: GITHUB_REPO }))),
  defaultBranch: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  hoursPerDay: Type.Optional(HoursPerDay),
  budgetHours: Type.Optional(NullableInput(Hours)),
  budgetDays: Type.Optional(NullableInput(Days)),
  startDate: Type.Optional(NullableInput(DateOnly)),
  dueDate: Type.Optional(NullableInput(DateOnly)),
}

export const ProjectCreateSchema = StrictObject(
  { name: Title, slug: Type.Optional(slug), ...projectFields },
  { description: 'Budget en budgetHours OU budgetDays (converti avec hoursPerDay, défaut 8 h)' },
)
export type ProjectCreate = Static<typeof ProjectCreateSchema>

export const ProjectUpdateSchema = StrictObject({ name: Type.Optional(Title), slug: Type.Optional(slug), ...projectFields })
export type ProjectUpdate = Static<typeof ProjectUpdateSchema>

export const ProjectParams = Type.Object({ projectId: Id })
