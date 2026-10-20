// IA (docs/SUITE.md §5) : interrupteur « Hors ligne / En ligne » de l'en-tête, pastilles Ollama et Claude,
// choix « Moteur : Auto · Ollama · Claude » dans le découpage d'une story, Claude grisé avec l'explication.
// L'API de test n'a ni Ollama ni Claude CLI : les deux moteurs y sont indisponibles.
import { createScenario, expect, openProject, test } from './helpers.ts'

test('mode hors ligne par défaut, pastilles des moteurs, Claude grisé dans le découpage', async ({ page, request }) => {
  const scenario = await createScenario(request, 'IA')
  await openProject(page, scenario.projectId)
  const header = page.locator('header')
  const online = header.getByRole('switch', { name: 'Hors ligne' })
  await expect(online).toHaveAttribute('aria-checked', 'false')
  await expect(header.getByRole('button', { name: /^Ollama : indisponible/ })).toBeVisible()
  await expect(header.getByRole('button', { name: /^Claude : indisponible — Claude : désactivé \(mode hors ligne\)/ })).toBeVisible()

  // Découpage de la story : commande segmentée, Claude grisé hors ligne.
  const row = page.getByRole('button', { name: new RegExp(`${scenario.storyTitle} : du `) }).first()
  await row.hover()
  await page.getByRole('button', { name: 'Générer les sous-tâches (IA)' }).first().click()
  const dialog = page.getByRole('dialog', { name: /Générer les sous-tâches/ })
  const engines = dialog.getByRole('radiogroup', { name: 'Moteur' })
  await expect(engines.getByRole('radio')).toHaveText(['Auto', 'Ollama', 'Claude'])
  await expect(engines.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true')
  await expect(engines.getByRole('radio', { name: 'Claude' })).toBeDisabled()
  await expect(dialog.getByText(/Claude grisé — Mode hors ligne/)).toBeVisible()
  await engines.getByRole('radio', { name: 'Ollama' }).click()
  await expect(engines.getByRole('radio', { name: 'Ollama' })).toHaveAttribute('aria-checked', 'true')
  await expect(dialog.getByRole('combobox', { name: 'Modèle Ollama' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Annuler' }).click()

  // En ligne : Claude reste grisé, avec la raison (CLI introuvable sur la machine de test).
  await online.click()
  const switchOn = header.getByRole('switch', { name: 'En ligne' })
  await expect(switchOn).toHaveAttribute('aria-checked', 'true')
  await expect(header.getByRole('button', { name: /^Claude : indisponible — Claude indisponible : Claude CLI introuvable/ })).toBeVisible()
  await header.getByRole('button', { name: 'IA', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Intelligence artificielle' })
  const claude = panel.getByRole('region', { name: 'Claude' })
  await expect(claude.getByText('Introuvable', { exact: true })).toBeVisible()
  await expect(claude.getByText('Session interactive dans le Terminal')).toBeVisible()
  await expect(panel.getByRole('radiogroup', { name: 'Modèle Claude' }).getByRole('radio', { name: 'Sonnet (défaut)' })).toHaveAttribute('aria-checked', 'true')
  await panel.getByRole('button', { name: 'Fermer' }).first().click()

  // Le réglage est gardé par le backend : relu après rechargement, puis remis hors ligne.
  await page.reload()
  await expect(header.getByRole('switch', { name: 'En ligne' })).toBeVisible()
  await header.getByRole('switch', { name: 'En ligne' }).click()
  await expect(header.getByRole('switch', { name: 'Hors ligne' })).toHaveAttribute('aria-checked', 'false')
})
