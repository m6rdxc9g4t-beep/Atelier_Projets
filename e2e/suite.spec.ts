// Suite Atelier (docs/SUITE.md) : marqueurs de thème sur <html>, sélecteur d'applications, import Atelier Tab.
import path from 'node:path'
import { api, expect, openProject, test } from './helpers.ts'

// Playwright est lancé depuis la racine du dépôt (playwright.config.ts).
const FIXTURE = path.resolve('backend', 'test', 'fixtures', 'atelier-tab-planning.json')

async function demoProjectId(request: Parameters<typeof api>[0]): Promise<number> {
  const projects = await api<{ id: number; name: string }[]>(request, '/api/projects')
  const demo = projects.find((project) => project.name === 'App E-Commerce v2')
  expect(demo, 'projet de démo').toBeDefined()
  return demo!.id
}

test('thème : data-theme et classe « dark » sur <html>, choix Clair / Sombre / Système', async ({ page, request }) => {
  await openProject(page, await demoProjectId(request))
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await expect(html).toHaveClass(/(^|\s)dark(\s|$)/)
  await expect(page).toHaveTitle('Atelier Projets')

  await page.getByRole('button', { name: 'Thème clair' }).click()
  await expect(html).toHaveAttribute('data-theme', 'light')
  await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/)

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByRole('button', { name: 'Thème du système' }).click()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(html).toHaveAttribute('data-theme', 'light')
  await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/)
})

test('sélecteur « Suite Atelier » : trois applications, courante cochée, clavier et Échap', async ({ page, request }) => {
  await openProject(page, await demoProjectId(request))
  const trigger = page.getByRole('button', { name: 'Suite Atelier : changer d’application' })
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const menu = page.getByRole('menu', { name: 'Suite Atelier' })
  await expect(menu).toBeVisible()
  const items = menu.getByRole('menuitemradio')
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toBeFocused()
  await expect(items.nth(0)).toHaveAttribute('href', /^http:\/\/127\.0\.0\.1:8000/)
  await expect(items.nth(1)).toHaveAttribute('href', /^http:\/\/127\.0\.0\.1:4175/)
  await expect(items.nth(2)).toHaveAttribute('aria-checked', 'true')
  // Projets répond (même origine) ; Atelier Tab n'a pas d'API, donc pas d'indicateur.
  await expect(items.nth(2)).toHaveAccessibleName(/En marche/)
  await expect(items.nth(1)).toHaveAccessibleName('Atelier Tab')

  await page.keyboard.press('ArrowUp')
  await expect(items.nth(2)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()

  await trigger.click()
  await expect(menu).toBeVisible()
  await page.locator('main').click({ position: { x: 600, y: 400 } })
  await expect(menu).toBeHidden()
})

test('importer un fichier DataFlow d’Atelier Tab : aperçu puis import', async ({ page, request }) => {
  await openProject(page, await demoProjectId(request), 'settings')
  await page.getByRole('button', { name: 'Importer depuis Atelier Tab…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Importer depuis Atelier Tab' })
  await dialog.locator('input[type=file]').setInputFiles(FIXTURE)
  await expect(dialog.getByText('Destination')).toBeVisible()
  await expect(dialog.getByText('3 à créer')).toBeVisible()
  await expect(dialog.getByText('Ligne 2 : statut « Validé » inconnu, « À faire » retenu.')).toBeVisible()

  await dialog.getByRole('button', { name: 'Importer 3 élément(s)' }).click()
  await expect(dialog.getByText('Import terminé')).toBeVisible()
  await expect(dialog.getByText('3 créé(s)')).toBeVisible()
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).last().click()

  // Le projet importé devient le projet courant ; ses éléments sont dans la phase « Imports Atelier Tab ».
  await expect(page.locator('header').getByRole('button', { name: 'Rénovation Urbaine 2026' })).toBeVisible()
  const projects = await api<{ id: number; name: string }[]>(request, '/api/projects')
  const imported = projects.find((project) => project.name === 'Rénovation Urbaine 2026')
  const dataset = await api<{ rows: { titre: string; phase: string }[] }>(request, `/api/exports/datasets/work-items?projectId=${imported!.id}`)
  expect(dataset.rows.map((row) => [row.titre, row.phase])).toEqual([
    ['Gros œuvre', 'Imports Atelier Tab'],
    ['Charpente bois', 'Imports Atelier Tab'],
    ['Isolation thermique', 'Imports Atelier Tab'],
  ])
})
