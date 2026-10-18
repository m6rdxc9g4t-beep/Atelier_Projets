// Gantt interactif : déplacer et redimensionner une barre, déplacer un jalon et une story avec son contenu,
// créer une dépendance en tirant le rond d'une barre, replanifier un conflit, chemin critique, impression.
import { api, bar, createScenario, day, dragBy, expect, expectToast, openProject, PX_PER_DAY_WEEK, test } from './helpers.ts'

test('déplacer puis redimensionner une tâche au jour près', async ({ page, request }) => {
  const s = await createScenario(request)
  await openProject(page, s.projectId)
  const c = bar(page, s.c)
  await expect(c).toBeVisible()

  await dragBy(page, c, 2 * PX_PER_DAY_WEEK)
  await expectToast(page, new RegExp(`#${s.c} déplacé de \\+2 j`))
  await expect.poll(async () => (await api(request, `/api/work-items/${s.c}`)).startDate).toBe(day(10))
  expect((await api(request, `/api/work-items/${s.c}`)).dueDate).toBe(day(11))

  await dragBy(page, bar(page, s.c), 3 * PX_PER_DAY_WEEK, 'right')
  await expectToast(page, new RegExp(`#${s.c} : fin décalée de \\+3 j`))
  await expect.poll(async () => (await api(request, `/api/work-items/${s.c}`)).dueDate).toBe(day(14))
  expect((await api(request, `/api/work-items/${s.c}`)).startDate).toBe(day(10))

  // Un simple clic (sans glisser) ouvre toujours la fiche.
  await bar(page, s.c).click()
  await expect(page.locator('aside').getByText('Recette').first()).toBeVisible()
})

test('déplacer un jalon et une story avec tout son contenu', async ({ page, request }) => {
  const s = await createScenario(request)
  await openProject(page, s.projectId)

  const milestone = page.locator('button[title^="Livraison"]')
  await dragBy(page, milestone.locator('.ds-diamond'), -3 * PX_PER_DAY_WEEK)
  await expectToast(page, /MILESTONE déplacé de -3 j/)
  await expect.poll(async () => (await api(request, `/api/milestones/${s.milestoneId}`)).date).toBe(day(9))

  await dragBy(page, bar(page, s.storyTitle), 7 * PX_PER_DAY_WEEK)
  await expectToast(page, /déplacé de \+7 j avec son contenu/)
  await expect.poll(async () => (await api(request, `/api/work-items/${s.a}`)).startDate).toBe(day(8))
  expect((await api(request, `/api/work-items/${s.c}`)).dueDate).toBe(day(16))
})

test('créer une dépendance en tirant le rond d’une barre, puis replanifier le conflit', async ({ page, request }) => {
  const s = await createScenario(request)
  await openProject(page, s.projectId)

  // Conflit du scénario : B commence avant la fin de A.
  const resolve = page.getByRole('button', { name: /1 conflit · Replanifier/ })
  await expect(resolve).toBeVisible()
  await expect(bar(page, s.b)).toHaveAttribute('data-conflict', '')

  // Tirer le rond au bout de B jusqu'à la barre de C : C attendra la fin de B.
  const handle = page.locator(`[data-item-id="${s.b}"] .gantt-link-handle`)
  await page.locator(`[data-item-id="${s.b}"]`).hover()
  const from = await handle.boundingBox()
  const to = await bar(page, s.c).boundingBox()
  if (!from || !to) throw new Error('barres invisibles')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
  await page.mouse.up()
  await expectToast(page, new RegExp(`#${s.c} commencera après la fin de #${s.b}`))
  await expect(page.locator('.gantt-link')).toHaveCount(2)
  const detail = await api(request, `/api/work-items/${s.c}`)
  expect(detail.predecessors.map((ref: { id: number }) => ref.id)).toEqual([s.b])

  await resolve.click()
  await expectToast(page, /1 élément\(s\) replanifié\(s\)/)
  await expect(resolve).toBeHidden()
  const b = await api(request, `/api/work-items/${s.b}`)
  expect([b.startDate, b.dueDate]).toEqual([day(4), day(6)])
  await expect(bar(page, s.b)).not.toHaveAttribute('data-conflict', '')
})

test('chemin critique, dépendances depuis la fiche et impression PDF', async ({ page, request }) => {
  const s = await createScenario(request)
  await page.addInitScript(() => {
    const record = window as unknown as { printed: { printing?: string; scale: string; theme?: string }[] }
    record.printed = []
    window.print = () => {
      const root = document.documentElement
      record.printed.push({ printing: root.dataset.printing, scale: root.style.getPropertyValue('--print-scale'), theme: root.dataset.theme })
      window.dispatchEvent(new Event('afterprint'))
    }
  })
  await openProject(page, s.projectId)

  // Ajout d'un prédécesseur depuis la fiche de C (recherche par #ID).
  await page.getByTitle(`#${s.c} : Recette`, { exact: true }).click()
  const aside = page.locator('aside')
  await aside.getByRole('button', { name: 'Prédécesseur' }).click()
  await aside.getByLabel('Rechercher le prédécesseur').fill(`#${s.a}`)
  await aside.getByRole('list', { name: 'Éléments proposés' }).getByRole('button', { name: new RegExp(`#${s.a}`) }).click()
  await expectToast(page, new RegExp(`#${s.c} commencera après la fin de #${s.a}`))
  await expect(aside.getByText('Attend la fin de')).toBeVisible()
  await expect(aside.getByText('marge 4 j')).toBeVisible()
  await aside.getByRole('button', { name: 'Fermer' }).first().click().catch(() => page.keyboard.press('Escape'))

  await page.getByRole('button', { name: 'Chemin critique', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Chemin critique', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(bar(page, s.c)).toHaveAttribute('data-critical', '')
  await expect(bar(page, s.a)).toHaveAttribute('data-faded', '')

  await page.getByRole('button', { name: 'PDF', exact: true }).click()
  const printed = await page.evaluate(() => (window as unknown as { printed: { printing?: string; scale: string; theme?: string }[] }).printed)
  expect(printed).toHaveLength(1)
  expect(printed[0]?.printing).toBe('gantt')
  expect(printed[0]?.theme).toBe('light')
  expect(Number(printed[0]?.scale)).toBeGreaterThan(0)
  expect(Number(printed[0]?.scale)).toBeLessThanOrEqual(1)
  // Au zoom « Jour », le diagramme est plus large : il est davantage réduit pour tenir sur la page.
  await page.getByLabel('Zoom').selectOption('day')
  await page.getByRole('button', { name: 'PDF', exact: true }).click()
  const [, daily] = await page.evaluate(() => (window as unknown as { printed: { scale: string }[] }).printed)
  const width = await page.locator('.gantt-content').evaluate((element) => element.scrollWidth)
  expect(Number(daily?.scale)).toBeLessThan(Number(printed[0]?.scale))
  expect(Number(daily?.scale)).toBeLessThan(1100 / width)
  // Après l'impression : thème et mise en page d'écran rétablis.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).not.toHaveAttribute('data-printing', /.*/)
})
