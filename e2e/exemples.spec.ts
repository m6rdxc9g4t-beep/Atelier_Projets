// « Exemples de la suite » : entrée au pied de la barre latérale (menu des projets au téléphone), fenêtre qui charge,
// ouvre et retire le projet d'une histoire ; barre latérale et vue courante suivent, le focus revient au déclencheur.
import type { APIRequestContext, Page } from '@playwright/test'
import { api, createScenario, expect, expectToast, openProject, overflowX, test, tooSmall } from './helpers.ts'

interface Histoire {
  id: string
  projet: string
  charge: boolean
}

/** Histoire livrée avec le dépôt, remise à l'état « non chargée » (la base est commune à toute la suite de tests). */
async function story(request: APIRequestContext, id: string): Promise<Histoire> {
  await request.delete(`/api/exemples-suite/${id}`)
  const found = (await api<Histoire[]>(request, '/api/exemples-suite')).find((candidate) => candidate.id === id)
  expect(found, `histoire ${id}`).toBeDefined()
  expect(found!.charge).toBe(false)
  return found!
}

const dialogOf = (page: Page) => page.getByRole('dialog', { name: 'Exemples de la suite' })

test('barre latérale : charger une histoire, voir son projet, retirer ; le focus revient à l’entrée', async ({ page, request }) => {
  const h = await story(request, 'boutique-librairie')
  const s = await createScenario(request, 'Exemples')
  await openProject(page, s.projectId)

  // Au pied de la barre, au-dessus de « Documentation API ».
  const trigger = page.getByRole('button', { name: 'Exemples de la suite', exact: true })
  const docs = page.getByRole('link', { name: 'Documentation API' })
  expect((await trigger.boundingBox())!.y).toBeLessThan((await docs.boundingBox())!.y)
  expect((await trigger.boundingBox())!.y).toBeGreaterThan(page.viewportSize()!.height - 150)

  await trigger.click()
  const dialog = dialogOf(page)
  const select = dialog.getByLabel('Histoire d’exemple')
  await expect(select).toBeFocused()
  await select.selectOption(h.id)

  // Charger : le projet de l'histoire apparaît dans la barre latérale et devient le projet courant.
  await dialog.getByRole('button', { name: 'Charger l’exemple' }).click()
  await expectToast(page, /Exemple « .* » chargé/)
  const tree = page.getByRole('region', { name: 'Projets' })
  await expect(tree.getByRole('button', { name: h.projet, exact: true })).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(h.projet)

  // Les boutons d'action ont été remplacés : le focus est rendu au premier, et Tab ne sort pas de la fenêtre.
  await expect(dialog.getByRole('button', { name: 'Ouvrir le projet' })).toBeFocused()
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  }

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()

  // Retirer : le projet quitte la barre latérale, un autre devient courant.
  await page.keyboard.press('Enter')
  await expect(select).toHaveValue(h.id)
  await dialog.getByRole('button', { name: 'Retirer l’exemple' }).click()
  await expectToast(page, /Exemple retiré/)
  await expect(tree.getByRole('button', { name: h.projet, exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1 })).not.toContainText(h.projet)
  await expect(dialog.getByRole('button', { name: 'Charger l’exemple' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Fermer' }).click()
  await expect(trigger).toBeFocused()
})

test('barre repliée : icône seule, nommée, avec info-bulle ; « Ouvrir le projet » ferme la fenêtre', async ({ page, request }) => {
  const h = await story(request, 'freelance-data')
  const s = await createScenario(request, 'Repliée')
  await openProject(page, s.projectId)
  await page.getByRole('button', { name: 'Afficher ou masquer les libellés du menu' }).click()

  const trigger = page.getByRole('button', { name: 'Exemples de la suite', exact: true })
  await expect(trigger).toHaveAttribute('title', 'Exemples de la suite')
  const box = (await trigger.boundingBox())!
  expect(box.width).toBeLessThan(52)
  // Le pied reste en bas de la barre repliée.
  expect(box.y).toBeGreaterThan(page.viewportSize()!.height - 220)

  await trigger.click()
  const dialog = dialogOf(page)
  await dialog.getByLabel('Histoire d’exemple').selectOption(h.id)
  await dialog.getByRole('button', { name: 'Charger l’exemple' }).click()
  await dialog.getByRole('button', { name: 'Ouvrir le projet' }).click()
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(h.projet)
  await request.delete(`/api/exemples-suite/${h.id}`)
})

test.describe('au téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('« Exemples de la suite » est dans le menu des projets, le focus y revient', async ({ page, request }) => {
    const h = await story(request, 'marketing-campagne')
    const s = await createScenario(request, 'Téléphone')
    const { name } = await api<{ name: string }>(request, `/api/projects/${s.projectId}`)
    await openProject(page, s.projectId)

    // Le pied de la barre latérale n'existe pas au téléphone : aucune entrée cachée ne reste focalisable.
    await expect(page.getByRole('button', { name: 'Exemples de la suite', exact: true })).toHaveCount(0)
    const switcher = page.getByRole('button', { name, exact: true })
    await switcher.tap()
    await page.getByRole('button', { name: 'Exemples de la suite…' }).tap()

    const dialog = dialogOf(page)
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Histoire d’exemple').selectOption(h.id)
    expect(await tooSmall(page)).toEqual([])
    expect(await overflowX(page)).toBe(0)

    await dialog.getByRole('button', { name: 'Charger l’exemple' }).tap()
    await expect(dialog.getByRole('button', { name: 'Ouvrir le projet' })).toBeFocused()
    expect(await tooSmall(page)).toEqual([])
    await dialog.getByRole('button', { name: 'Ouvrir le projet' }).tap()
    await expect(dialog).toBeHidden()
    // Le sélecteur de projet, qui a ouvert le menu, porte maintenant le nom du projet de l'histoire.
    const current = page.getByRole('button', { name: h.projet, exact: true })
    await expect(current).toBeFocused()
    await request.delete(`/api/exemples-suite/${h.id}`)
  })
})

test('Paramètres ne répète plus la carte des exemples ; l’écran sans projet la garde', async ({ page, request }) => {
  const s = await createScenario(request, 'Emplacements')
  await openProject(page, s.projectId, 'settings')
  await expect(page.getByText('Sauvegardes de la base').first()).toBeVisible()
  await expect(page.getByRole('main').getByText('Exemples de la suite')).toHaveCount(0)

  // Sans aucun projet (liste vide simulée) : la carte guide encore le premier lancement.
  await page.route('**/api/projects', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.continue()))
  await page.route(`**/api/projects/${s.projectId}`, (route) =>
    route.fulfill({ status: 404, json: { statusCode: 404, error: 'Not Found', code: 'NOT_FOUND', message: 'Projet introuvable.' } }),
  )
  await page.reload()
  await expect(page.getByText('Aucun projet pour l’instant')).toBeVisible()
  await expect(page.getByRole('main').getByRole('heading', { name: 'Exemples de la suite' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('button', { name: 'Charger l’exemple' })).toBeVisible()
})
