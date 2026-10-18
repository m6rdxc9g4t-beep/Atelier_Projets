// Parcours de base sur le projet de démo : chaque vue s'affiche sans erreur.
import { api, expect, openProject, test } from './helpers.ts'

test('les quatre vues du projet de démo s’affichent', async ({ page, request }) => {
  const projects = await api<{ id: number; name: string }[]>(request, '/api/projects')
  const demo = projects.find((project) => project.name === 'App E-Commerce v2')
  expect(demo, 'projet de démo').toBeDefined()
  await openProject(page, demo!.id)

  await expect(page.getByRole('grid', { name: 'Diagramme de Gantt' })).toBeVisible()
  await expect(page.getByText('#103', { exact: true }).first()).toBeVisible()

  for (const [tab, check] of [
    ['Tableau de bord', /Budget/],
    ['Tableau des temps', /Tableau des temps/],
    ['Paramètres du projet', /Sauvegardes de la base/],
  ] as const) {
    await page.getByRole('tab', { name: tab }).click()
    await expect(page.getByText(check).first()).toBeVisible()
  }
})
