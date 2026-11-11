// Ergonomie : focus des fenêtres, saisies conservées en cas d'erreur ou de fermeture rapide, Gantt au téléphone.
import path from 'node:path'
import { api, createScenario, expect, openProject, test } from './helpers.ts'

const FIXTURE = path.resolve('backend', 'test', 'fixtures', 'atelier-tab-planning.json')

test('import Atelier Tab : le focus reste sur le champ modifié, puis revient au bouton d’ouverture', async ({ page, request }) => {
  const s = await createScenario(request, 'Focus')
  await openProject(page, s.projectId, 'settings')
  const trigger = page.getByRole('button', { name: 'Importer depuis Atelier Tab…' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Importer depuis Atelier Tab' })
  await dialog.locator('input[type=file]').setInputFiles(FIXTURE)
  await expect(dialog.getByText('3 à créer')).toBeVisible()

  // Changer le type relit l'aperçu (nouveaux rendus) : le focus ne doit pas repartir au premier bouton.
  const type = dialog.getByLabel('Type des nouveaux éléments')
  await type.focus()
  await type.selectOption('FEATURE')
  await expect(dialog.getByText('3 à créer')).toBeVisible()
  await expect(type).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('fiche : un titre refusé par l’API reste dans le champ', async ({ page, request }) => {
  const s = await createScenario(request, 'Titre')
  await openProject(page, s.projectId)
  await page.getByTitle(`#${s.a} : Maquette`, { exact: true }).click()
  const aside = page.locator('aside')
  await aside.getByRole('button', { name: 'Modifier le titre' }).click()

  await page.route(`**/api/work-items/${s.a}*`, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ statusCode: 500, code: 'INTERNAL', message: 'Erreur interne' }) })
      : route.fallback(),
  )
  const input = aside.getByLabel('Titre', { exact: true })
  await input.fill('Maquette haute fidélité')
  await input.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: 'Erreur interne' })).toBeVisible()
  await expect(input).toHaveValue('Maquette haute fidélité')

  // L'API répond de nouveau : le même texte s'enregistre sans être ressaisi.
  await page.unroute(`**/api/work-items/${s.a}*`)
  await input.press('Enter')
  await expect(aside.getByRole('heading', { name: /Maquette haute fidélité/ })).toBeVisible()
})

test('fiche : l’avancement réglé juste avant de fermer est enregistré', async ({ page, request }) => {
  const s = await createScenario(request, 'Avancement')
  await openProject(page, s.projectId)
  await page.getByTitle(`#${s.c} : Recette`, { exact: true }).click()
  const aside = page.locator('aside')
  const slider = aside.getByLabel('Avancement déclaré')
  await slider.focus()
  await slider.press('ArrowRight')
  await slider.press('ArrowRight')
  await aside.getByRole('button', { name: 'Fermer la fiche' }).click()
  await expect(aside).toBeHidden()
  await expect.poll(async () => (await api(request, `/api/work-items/${s.c}`)).progress).toBe(10)
})

test.describe('au téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('Gantt : titres lisibles dans la colonne figée, ajout d’un élément au doigt', async ({ page, request }) => {
    const s = await createScenario(request, 'Téléphone')
    await openProject(page, s.projectId)
    const title = page.getByTitle(`#${s.a} : Maquette`, { exact: true })
    await expect(title).toBeVisible()
    expect((await title.boundingBox())!.width).toBeGreaterThan(90)

    // Sans survol, les actions de la ligne restent affichées : la story reçoit un élément.
    await page.getByRole('button', { name: 'Ajouter un élément' }).tap()
    const dialog = page.getByRole('dialog', { name: 'Nouvel élément' })
    await dialog.getByLabel('Titre').fill('Tests au doigt')
    await dialog.getByRole('button', { name: 'Créer', exact: true }).tap()
    await expect(page.getByTitle(/ : Tests au doigt$/)).toBeVisible()
  })
})
