// =============================================================================
// Seed : insère le projet de démo « App E-Commerce v2 » (données : prisma/demo-project.ts).
// Lancement : npm run db:seed  (prisma db seed → tsx prisma/seed.ts) — idempotent.
// =============================================================================
import { loadEnvFile, resolveDatabaseUrl } from '../src/config.ts'
import { createPrismaClient, type PrismaClient } from '../src/db/client.ts'
import { seedDemoProject } from './demo-project.ts'

async function printSummary(prisma: PrismaClient, projectId: number): Promise<void> {
  const [project, phases, epics, stories, workItems, milestones, timeEntries, commits, pullRequests] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    prisma.phase.count({ where: { projectId } }),
    prisma.epic.count({ where: { phase: { projectId } } }),
    prisma.story.count({ where: { epic: { phase: { projectId } } } }),
    prisma.workItem.count({ where: { projectId } }),
    prisma.milestone.count({ where: { projectId } }),
    prisma.timeEntry.count({ where: { workItem: { projectId } } }),
    prisma.gitCommit.count({ where: { projectId } }),
    prisma.pullRequest.count({ where: { projectId } }),
  ])
  const spent = await prisma.timeEntry.aggregate({ where: { workItem: { projectId } }, _sum: { hours: true } })
  const spentHours = spent._sum.hours ?? 0
  const budgetHours = project.budgetHours ?? 0
  const days = (hours: number): string => (hours / project.hoursPerDay).toFixed(1)

  console.log(`✔ Projet de démo « ${project.name} » inséré (id ${projectId})`)
  console.log(
    `  ${phases} phases · ${epics} epics · ${stories} stories · ${workItems} work items · ${milestones} jalons · ` +
      `${timeEntries} saisies de temps · ${commits} commits · ${pullRequests} pull request(s)`,
  )
  console.log(
    `  Budget initial ${days(budgetHours)} j (${budgetHours} h) · Temps réalisé ${days(spentHours)} j (${spentHours} h) · ` +
      `1 jour = ${project.hoursPerDay} h`,
  )
}

loadEnvFile()
const prisma = createPrismaClient(resolveDatabaseUrl())
try {
  const projectId = await seedDemoProject(prisma)
  await printSummary(prisma, projectId)
} catch (error) {
  console.error('✘ Échec du seed :', error)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
