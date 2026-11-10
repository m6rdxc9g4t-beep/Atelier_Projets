// Barre latérale : arborescence Projets › Phases (modèle d'Atelier Tab), suppression d'une phase et d'un projet.
import { api, createScenario, expect, expectToast, openProject, test } from './helpers.ts'

test('l’arborescence montre les phases et permet de supprimer une phase puis un projet', async ({ page, request }) => {
  const scenario = await createScenario(request, 'Barre latérale')
  const project = await api<{ id: number; name: string }>(request, `/api/projects/${scenario.projectId}`)
  await openProject(page, scenario.projectId)

  const tree = page.getByRole('region', { name: 'Projets' })
  const row = tree.getByRole('button', { name: project.name, exact: true })
  await expect(row).toHaveAttribute('aria-current', 'true')

  // Déplier : la phase du scénario apparaît ; un clic l'ouvre dans le Gantt.
  await tree.getByRole('button', { name: `Déplier ${project.name}` }).click()
  const phases = tree.getByRole('list', { name: `Phases de ${project.name}` })
  const phaseTree = await api<{ phases: { id: number; title: string }[] }>(request, `/api/projects/${scenario.projectId}/tree`)
  const phase = phaseTree.phases.find((candidate) => candidate.id === scenario.phaseId)!
  const phaseButton = phases.getByRole('button', { name: new RegExp(`^${phase.title}`) })
  await expect(phaseButton).toBeVisible()
  await phaseButton.click()
  await expect(page.locator(`[data-row-key="phase-${phase.id}"] [data-row-title]`)).toBeFocused()

  // Supprimer la phase (confirmation avec le contenu).
  await phases.getByRole('listitem').filter({ hasText: phase.title }).hover()
  await tree.getByRole('button', { name: `Supprimer la phase ${phase.title}` }).click()
  const phaseDialog = page.getByRole('dialog', { name: `Supprimer la phase « ${phase.title} » ?` })
  await expect(phaseDialog).toContainText('élément')
  await phaseDialog.getByRole('button', { name: 'Supprimer' }).click()
  await expectToast(page, /Phase « .* » supprimée/)
  await expect(phases.getByText('Aucune phase')).toBeVisible()

  // Supprimer le projet : il disparaît de la barre, un autre projet devient courant.
  await row.hover()
  await tree.getByRole('button', { name: `Supprimer le projet ${project.name}` }).click()
  const projectDialog = page.getByRole('dialog', { name: `Supprimer le projet « ${project.name} » ?` })
  await expect(projectDialog).toContainText('phase')
  await projectDialog.getByRole('button', { name: 'Supprimer' }).click()
  await expectToast(page, /Projet « .* » supprimé/)
  await expect(tree.getByRole('button', { name: project.name, exact: true })).toHaveCount(0)
  const response = await request.get(`/api/projects/${scenario.projectId}`)
  expect(response.status()).toBe(404)
})

test('renommer un projet par double-clic', async ({ page, request }) => {
  const scenario = await createScenario(request, 'Renommage')
  const project = await api<{ name: string }>(request, `/api/projects/${scenario.projectId}`)
  await openProject(page, scenario.projectId)

  const tree = page.getByRole('region', { name: 'Projets' })
  await tree.getByRole('button', { name: project.name, exact: true }).dblclick()
  const input = tree.getByRole('textbox', { name: 'Nom du projet' })
  await input.fill(`${project.name} bis`)
  await input.press('Enter')
  await expect(tree.getByRole('button', { name: `${project.name} bis`, exact: true })).toBeVisible()
})
