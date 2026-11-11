// Ergonomie : focus des fenêtres, saisies conservées en cas d'erreur ou de fermeture rapide.
import path from 'node:path'
import { createScenario, expect, openProject, test } from './helpers.ts'

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
