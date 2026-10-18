// Outils des tests de navigateur : projet de test créé par l'API, ouverture de l'interface sur ce projet,
// glisser-déposer sur le Gantt.
import { expect, test as base, type APIRequestContext, type Locator, type Page } from '@playwright/test'

/** Largeur d'un jour dans le Gantt au zoom « Semaine » (GanttView.tsx). */
export const PX_PER_DAY_WEEK = 18

/** Date calendaire décalée de `offset` jours depuis aujourd'hui (fuseau de Paris). */
export function day(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)
}

let sequence = 0

async function post<T = any>(request: APIRequestContext, url: string, data?: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} → ${response.status()} ${await response.text()}`).toBeTruthy()
  return response.status() === 204 ? (undefined as T) : ((await response.json()) as T)
}

export async function api<T = any>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(url)
  expect(response.ok(), `${url} → ${response.status()}`).toBeTruthy()
  return (await response.json()) as T
}

export interface Scenario {
  projectId: number
  phaseId: number
  storyId: number
  storyTitle: string
  /** A (j+1 → j+3), B (j+2 → j+4, attend A : conflit), C (j+8 → j+9). */
  a: number
  b: number
  c: number
  milestoneId: number
}

/** Projet planifié autour d'aujourd'hui (visible sans défilement), avec une dépendance en conflit. */
export async function createScenario(request: APIRequestContext, name = 'Gantt'): Promise<Scenario> {
  sequence += 1
  const project = await post(request, '/api/projects', { name: `E2E ${name} ${Date.now()}-${sequence}` })
  const phase = await post(request, `/api/projects/${project.id}/phases`, { title: 'Réalisation' })
  const epic = await post(request, `/api/phases/${phase.id}/epics`, { title: 'Catalogue' })
  const storyTitle = 'Fiche produit'
  const story = await post(request, `/api/epics/${epic.id}/stories`, { title: storyTitle })
  const item = (title: string, type: string, start: number, end: number) =>
    post(request, `/api/stories/${story.id}/work-items`, { type, title, startDate: day(start), dueDate: day(end), estimatedHours: 8 })
  const a = await item('Maquette', 'TASK', 1, 3)
  const b = await item('Intégration', 'TASK', 2, 4)
  const c = await item('Recette', 'FEATURE', 8, 9)
  await post(request, `/api/work-items/${b.id}/dependencies`, { predecessorId: a.id })
  const milestone = await post(request, `/api/projects/${project.id}/milestones`, { title: 'Livraison', date: day(12), phaseId: phase.id })
  return { projectId: project.id, phaseId: phase.id, storyId: story.id, storyTitle, a: a.id, b: b.id, c: c.id, milestoneId: milestone.id }
}

/** Ouvre l'interface sur un projet et une vue (préférences d'interface posées avant le chargement). */
export async function openProject(page: Page, projectId: number, view: 'gantt' | 'timesheet' | 'settings' | 'dashboard' = 'gantt') {
  await page.addInitScript(
    ({ projectId, view }) => {
      if (sessionStorage.getItem('e2e-init')) return
      localStorage.setItem('atelier-projets:ui', JSON.stringify({ state: { theme: 'dark', view, projectId }, version: 0 }))
      sessionStorage.setItem('e2e-init', '1')
    },
    { projectId, view },
  )
  await page.goto('/')
}

/** Barre du Gantt d'un élément (#id) ou d'un conteneur (titre). */
export function bar(page: Page, label: string | number): Locator {
  const name = typeof label === 'number' ? new RegExp(`^#${label} .* : du `) : new RegExp(`${label} : du `)
  return page.getByRole('button', { name }).locator('.ds-bar')
}

/** Appui, glissement horizontal (dx px) et relâchement depuis un point d'un élément. */
export async function dragBy(page: Page, target: Locator, dx: number, from: 'center' | 'left' | 'right' = 'center') {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error('Élément sans position à l’écran')
  const x = from === 'left' ? box.x + 2 : from === 'right' ? box.x + box.width - 2 : box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y, { steps: 4 })
  await page.mouse.move(x + dx, y, { steps: 4 })
  await page.mouse.up()
}

/** Notification affichée (rôle status). */
export async function expectToast(page: Page, text: RegExp) {
  await expect(page.getByRole('status').filter({ hasText: text }).first()).toBeVisible()
}

/** Test qui échoue aussi sur une erreur JavaScript ou une erreur de la console du navigateur. */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
      page.on('console', (message) => {
        // Les réponses 4xx attendues (refus de l'API) sont signalées par le navigateur : elles ne comptent pas.
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text())
      })
      await use()
      expect(errors, 'erreurs dans la console du navigateur').toEqual([])
    },
    { auto: true },
  ],
})
export { expect }
