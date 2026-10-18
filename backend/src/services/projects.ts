// Projets : CRUD, slug unique, budget saisi en heures ou en jours.
import { DEFAULT_HOURS_PER_DAY } from '../domain/durations.ts'
import { slugify, uniqueSlug } from '../domain/slug.ts'
import type { PrismaClient } from '../db/client.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { badRequest, conflict } from '../http/errors.ts'
import type { ProjectCreate, ProjectDto, ProjectUpdate } from '../schemas/projects.ts'
import { assertDateOrder, inputDate, requireProject, resolveDate, resolveHours } from './common.ts'
import { toProjectDto } from './mappers.ts'

function assertGithubPair(owner: string | null, repo: string | null): void {
  if ((owner === null) !== (repo === null)) {
    throw badRequest('Le dépôt GitHub se définit par githubOwner ET githubRepo (ou aucun des deux)')
  }
}

async function freeSlug(prisma: PrismaClient, base: string): Promise<string> {
  const taken = await prisma.project.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })
  const slugs = new Set(taken.map((project) => project.slug))
  return uniqueSlug(base, (slug) => slugs.has(slug))
}

async function assertSlugAvailable(prisma: PrismaClient, slug: string): Promise<void> {
  if (await prisma.project.findUnique({ where: { slug }, select: { id: true } })) {
    throw conflict(`Le slug « ${slug} » est déjà utilisé par un autre projet`)
  }
}

export async function listProjects(prisma: PrismaClient): Promise<ProjectDto[]> {
  const projects = await prisma.project.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] })
  return projects.map(toProjectDto)
}

export async function getProject(prisma: PrismaClient, projectId: number): Promise<ProjectDto> {
  return toProjectDto(await requireProject(prisma, projectId))
}

export async function createProject(prisma: PrismaClient, input: ProjectCreate): Promise<ProjectDto> {
  const hoursPerDay = input.hoursPerDay ?? DEFAULT_HOURS_PER_DAY
  const startDate = inputDate(input.startDate ?? null)
  const dueDate = inputDate(input.dueDate ?? null)
  assertDateOrder(startDate, dueDate)
  const githubOwner = input.githubOwner ?? null
  const githubRepo = input.githubRepo ?? null
  assertGithubPair(githubOwner, githubRepo)

  let slug: string
  if (input.slug !== undefined) {
    await assertSlugAvailable(prisma, input.slug)
    slug = input.slug
  } else {
    slug = await freeSlug(prisma, slugify(input.name))
  }

  const project = await prisma.project.create({
    data: {
      name: input.name.trim(),
      slug,
      description: input.description ?? '',
      localRepoPath: input.localRepoPath ?? null,
      githubOwner,
      githubRepo,
      defaultBranch: input.defaultBranch ?? 'main',
      hoursPerDay,
      budgetHours: resolveHours(input.budgetHours, input.budgetDays, hoursPerDay, 'budget') ?? null,
      startDate,
      dueDate,
    },
  })
  return toProjectDto(project)
}

export async function updateProject(prisma: PrismaClient, projectId: number, input: ProjectUpdate): Promise<ProjectDto> {
  const current = await requireProject(prisma, projectId)
  const hoursPerDay = input.hoursPerDay ?? current.hoursPerDay
  const startDate = resolveDate(input.startDate, current.startDate)
  const dueDate = resolveDate(input.dueDate, current.dueDate)
  assertDateOrder(startDate, dueDate)
  const githubOwner = input.githubOwner === undefined ? current.githubOwner : input.githubOwner
  const githubRepo = input.githubRepo === undefined ? current.githubRepo : input.githubRepo
  assertGithubPair(githubOwner, githubRepo)
  if (input.slug !== undefined && input.slug !== current.slug) await assertSlugAvailable(prisma, input.slug)

  const data: Prisma.ProjectUpdateInput = { startDate, dueDate, githubOwner, githubRepo, hoursPerDay }
  if (input.name !== undefined) data.name = input.name.trim()
  if (input.slug !== undefined) data.slug = input.slug
  if (input.description !== undefined) data.description = input.description
  if (input.localRepoPath !== undefined) data.localRepoPath = input.localRepoPath
  if (input.defaultBranch !== undefined) data.defaultBranch = input.defaultBranch
  const budgetHours = resolveHours(input.budgetHours, input.budgetDays, hoursPerDay, 'budget')
  if (budgetHours !== undefined) data.budgetHours = budgetHours

  return toProjectDto(await prisma.project.update({ where: { id: projectId }, data }))
}

export async function deleteProject(prisma: PrismaClient, projectId: number): Promise<void> {
  await requireProject(prisma, projectId)
  await prisma.project.delete({ where: { id: projectId } })
}
