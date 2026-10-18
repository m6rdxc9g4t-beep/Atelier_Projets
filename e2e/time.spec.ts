// Chronomètre (fiche → pastille de l'en-tête → saisie de temps), export CSV des temps, sauvegarde de la base.
import { readFile } from 'node:fs/promises'
import { api, createScenario, expect, expectToast, openProject, test } from './helpers.ts'

test('chronométrer une tâche puis saisir le temps avec un commentaire', async ({ page, request }) => {
  const s = await createScenario(request, 'Chrono')
  await openProject(page, s.projectId)
  await page.getByTitle(`#${s.a} : Maquette`, { exact: true }).click()
  const aside = page.locator('aside')
  await aside.getByRole('button', { name: 'Chrono' }).click()
  await expectToast(page, new RegExp(`Chronomètre démarré sur #${s.a}`))

  const pill = page.locator('header').getByRole('button', { name: /^\d{2}:\d{2}/ })
  await expect(pill).toContainText(`#${s.a}`)
  await expect(pill).toContainText(/00:0[1-9]/, { timeout: 5_000 })

  // Démarrer sur un autre élément arrête et saisit le premier.
  await page.getByTitle(`#${s.b} : Intégration`, { exact: true }).click()
  await page.locator('aside').getByRole('button', { name: 'Chrono' }).click()
  await expectToast(page, new RegExp(`saisies sur #${s.a} ; chronomètre démarré sur #${s.b}`))

  await pill.click()
  const popover = page.getByRole('dialog', { name: 'Chronomètre' })
  await popover.getByLabel('Commentaire de la saisie (facultatif)').fill('Intégration API')
  await popover.getByRole('button', { name: 'Arrêter et saisir' }).click()
  await expectToast(page, new RegExp(`saisies sur #${s.b}`))
  await expect(pill).toBeHidden()

  const b = await api(request, `/api/work-items/${s.b}`)
  expect(b.timeEntries.map((entry: { comment: string }) => entry.comment)).toEqual(['Intégration API'])
  const a = await api(request, `/api/work-items/${s.a}`)
  expect(a.timeEntries.map((entry: { comment: string }) => entry.comment)).toEqual(['Chronomètre'])
  expect(await api(request, '/api/timer')).toEqual({ timer: null })
})

test('exporter le tableau des temps en CSV', async ({ page, request }) => {
  const s = await createScenario(request, 'CSV')
  await openProject(page, s.projectId, 'timesheet')
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^temps-.*\.csv$/)
  const content = await readFile((await file.path()) as string, 'utf8')
  const lines = content.replace(/^﻿/, '').trim().split('\r\n')
  expect(lines[0]).toBe('ID;Type;Titre;Statut;Phase;Epic;Story;Budget (j);Réalisé (j);Réalisé (h);Bilan;Écart (j)')
  expect(lines).toHaveLength(5)
  expect(lines.at(-1)).toMatch(/^TOTAL;3 éléments;/)
})

test('sauvegarder la base depuis les paramètres et télécharger la copie', async ({ page, request }) => {
  const s = await createScenario(request, 'Sauvegarde')
  await openProject(page, s.projectId, 'settings')
  await page.getByRole('button', { name: 'Sauvegarder maintenant' }).click()
  await expectToast(page, /Base sauvegardée/)
  const list = page.getByRole('list', { name: 'Sauvegardes disponibles' })
  await expect(list.getByText(/manuelle/).first()).toBeVisible()

  const { backups } = await api(request, '/api/backups')
  const response = await request.get(`/api/backups/${backups[0].name}`)
  expect(response.ok()).toBeTruthy()
  expect((await response.body()).subarray(0, 15).toString()).toBe('SQLite format 3')
})
