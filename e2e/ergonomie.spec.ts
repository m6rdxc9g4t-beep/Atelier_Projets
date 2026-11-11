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

test('une tâche créée par une autre app apparaît au retour sur la fenêtre', async ({ page, request }) => {
  const s = await createScenario(request, 'Retour')
  await page.clock.install()
  await openProject(page, s.projectId)
  await expect(page.getByTitle(`#${s.a} : Maquette`, { exact: true })).toBeVisible()

  // La fenêtre passe en arrière-plan ; pendant ce temps, une autre app (un workflow de Nexus) crée une tâche.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  const response = await request.post(`/api/stories/${s.storyId}/work-items`, { data: { type: 'TASK', title: 'Créée ailleurs' } })
  expect(response.ok()).toBeTruthy()
  await page.clock.fastForward(10_000)
  await expect(page.getByTitle(/ : Créée ailleurs$/)).toBeHidden()

  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByTitle(/ : Créée ailleurs$/)).toBeVisible()
})

test('retour sur la fenêtre : un dialogue ouvert garde sa saisie, la relecture suit sa fermeture', async ({ page, request }) => {
  const s = await createScenario(request, 'Saisie')
  await page.clock.install()
  await openProject(page, s.projectId)
  await page.locator(`[data-row-key="milestone-${s.milestoneId}"] [data-row-title]`).click()
  const dialog = page.getByRole('dialog')
  const title = dialog.getByLabel('Titre')
  await expect(title).toHaveValue('Livraison')
  await title.fill('Livraison décalée')

  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  const response = await request.post(`/api/stories/${s.storyId}/work-items`, { data: { type: 'TASK', title: 'Créée pendant la saisie' } })
  expect(response.ok()).toBeTruthy()
  await page.clock.fastForward(10_000)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.clock.fastForward(1_000)
  await expect(title).toHaveValue('Livraison décalée')

  await dialog.getByRole('button', { name: 'Annuler' }).click()
  await expect(page.getByTitle(/ : Créée pendant la saisie$/)).toBeVisible()
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

  test('cibles d’au moins 40 px et champs à 16 px (pas de zoom d’iOS), panneau IA accessible', async ({ page, request }) => {
    const s = await createScenario(request, 'Doigt')
    await openProject(page, s.projectId)
    await page.getByTitle(`#${s.a} : Maquette`, { exact: true }).click()
    const aside = page.locator('aside')
    await expect(aside.getByLabel('Avancement déclaré')).toBeVisible()

    // Hors des lignes du Gantt (36 px, géométrie du diagramme) et de la marque commune (copie de la suite).
    const tooSmall = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button, select, input, textarea, a[href]')]
        .filter((element) => !element.closest('.gantt, .atelier-brand'))
        .flatMap((element) => {
          const box = element.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) return []
          const field = element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'file'].includes(element.type))
          const small = box.height < 39.5 || (field && Number.parseFloat(getComputedStyle(element).fontSize) < 16)
          return small ? [`${Math.round(box.width)}×${Math.round(box.height)} ${element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 30) ?? element.tagName}`] : []
        }),
    )
    expect(tooSmall).toEqual([])

    await aside.getByRole('button', { name: 'Fermer la fiche' }).tap()
    await page.getByRole('button', { name: 'IA', exact: true }).tap()
    await expect(page.getByRole('dialog', { name: 'Intelligence artificielle' })).toBeVisible()
  })
})
