// Tests unitaires du domaine métier (fonctions pures, sans base ni HTTP).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { aggregate, deriveStatus, effectiveProgress, progressSummary } from '../src/domain/aggregates.ts'
import { computeBalance, computeEnvelopeBalance, computeTrend } from '../src/domain/balance.ts'
import { formatDateOnly, parseDateOnly, todayDateOnly } from '../src/domain/dates.ts'
import { daysToHours, percentOf, roundTo, sumHours, toDuration } from '../src/domain/durations.ts'
import { computeCodes, effectiveSpan, enclosingSpan } from '../src/domain/hierarchy.ts'
import { appendLogEntry, formatLogEntry } from '../src/domain/implementation-log.ts'
import { slugify, uniqueSlug } from '../src/domain/slug.ts'
import type { WorkItemStatus } from '../src/domain/workflow.ts'

describe('durées (1 jour = X heures)', () => {
  it('convertit les heures en jours avec le paramètre du projet', () => {
    assert.deepEqual(toDuration(24, 8), { hours: 24, days: 3 })
    assert.deepEqual(toDuration(18, 8), { hours: 18, days: 2.25 })
    assert.deepEqual(toDuration(4.5, 8), { hours: 4.5, days: 0.5625 })
    assert.deepEqual(toDuration(10, 7), { hours: 10, days: 1.4286 })
    assert.equal(daysToHours(2.5, 8), 20)
    assert.equal(daysToHours(3, 7.5), 22.5)
  })

  it('refuse un paramètre jour/heures invalide', () => {
    assert.throws(() => toDuration(8, 0), RangeError)
    assert.throws(() => toDuration(8, 25), RangeError)
  })

  it('arrondit sans artefact binaire et normalise -0', () => {
    assert.equal(roundTo(1.005, 2), 1.01)
    assert.equal(roundTo(-2.5, 0), -3)
    assert.ok(Object.is(roundTo(-0.0001, 2), 0))
    assert.equal(sumHours([0.1, 0.2]), 0.3)
    assert.equal(percentOf(228, 360), 63.3)
    assert.equal(percentOf(1, 0), null)
  })
})

describe('avancement et statut agrégés', () => {
  const item = (status: WorkItemStatus, progress: number, estimatedHours: number | null, spentHours = 0) => ({
    status,
    progress,
    estimatedHours,
    spentHours,
  })

  it('compte un élément terminé à 100 % et ignore les rejetés', () => {
    assert.equal(effectiveProgress({ status: 'CLOSED', progress: 40 }), 100)
    assert.equal(effectiveProgress({ status: 'RESOLVED', progress: 0 }), 100)
    assert.equal(effectiveProgress({ status: 'REJECTED', progress: 50 }), null)
    assert.equal(effectiveProgress({ status: 'IN_PROGRESS', progress: 140 }), 100)
  })

  it('pondère l’avancement par les estimations', () => {
    const summary = progressSummary([item('CLOSED', 100, 24), item('IN_PROGRESS', 50, 8), item('REJECTED', 0, 80)])
    assert.deepEqual(summary, { percent: 87.5, plannedHours: 32, earnedHours: 28 })
  })

  it('fait une moyenne simple sans aucune estimation, 0 % sans élément', () => {
    assert.equal(progressSummary([item('OPEN', 0, null), item('IN_PROGRESS', 50, null)]).percent, 25)
    assert.equal(progressSummary([]).percent, 0)
  })

  it('dérive le statut d’un conteneur', () => {
    assert.equal(deriveStatus([]), 'OPEN')
    assert.equal(deriveStatus(['REJECTED', 'REJECTED']), 'REJECTED')
    assert.equal(deriveStatus(['CLOSED', 'CLOSED', 'REJECTED']), 'CLOSED')
    assert.equal(deriveStatus(['CLOSED', 'RESOLVED']), 'RESOLVED')
    assert.equal(deriveStatus(['OPEN', 'OPEN']), 'OPEN')
    // Story 1.1 de la démo : Closed + Resolved + In review → en cours
    assert.equal(deriveStatus(['CLOSED', 'RESOLVED', 'IN_REVIEW']), 'IN_PROGRESS')
    assert.equal(deriveStatus(['BLOCKED', 'OPEN']), 'IN_PROGRESS')
  })

  it('agrège budget (hors rejetés), réalisé (tout compris) et répartition des statuts', () => {
    const result = aggregate([item('CLOSED', 100, 24, 20), item('BLOCKED', 0, 24, 4), item('REJECTED', 0, 8, 1)])
    assert.equal(result.estimateHours, 48)
    assert.equal(result.spentHours, 25)
    assert.equal(result.workItems, 3)
    assert.equal(result.status, 'IN_PROGRESS')
    assert.equal(result.progress, 50)
    assert.equal(result.statusCounts.CLOSED, 1)
    assert.equal(result.statusCounts.BLOCKED, 1)
    assert.equal(result.statusCounts.REJECTED, 1)
    assert.equal(result.statusCounts.OPEN, 0)
  })
})

describe('bilans du tableau des temps (maquette README §4.D)', () => {
  it('reproduit les cinq lignes de la maquette', () => {
    assert.deepEqual(computeBalance({ status: 'CLOSED', estimatedHours: 24, spentHours: 20 }), { kind: 'UNDER', deltaHours: -4 })
    assert.deepEqual(computeBalance({ status: 'RESOLVED', estimatedHours: 16, spentHours: 16 }), {
      kind: 'ON_BUDGET',
      deltaHours: 0,
    })
    assert.deepEqual(computeBalance({ status: 'IN_REVIEW', estimatedHours: 8, spentHours: 14 }), { kind: 'OVER', deltaHours: 6 })
    assert.deepEqual(computeBalance({ status: 'IN_PROGRESS', estimatedHours: 24, spentHours: 18 }), {
      kind: 'REMAINING',
      deltaHours: 6,
    })
    assert.deepEqual(computeBalance({ status: 'BLOCKED', estimatedHours: 24, spentHours: 4 }), {
      kind: 'REMAINING',
      deltaHours: 20,
    })
  })

  it('ne calcule pas de bilan sans estimation ou pour un élément rejeté', () => {
    assert.equal(computeBalance({ status: 'OPEN', estimatedHours: null, spentHours: 3 }), null)
    assert.equal(computeBalance({ status: 'REJECTED', estimatedHours: 8, spentHours: 3 }), null)
  })

  it('donne le solde d’une enveloppe : reste à consommer ou dépassement, toujours positif', () => {
    assert.deepEqual(computeEnvelopeBalance(360, 228), { kind: 'REMAINING', deltaHours: 132 })
    assert.deepEqual(computeEnvelopeBalance(48, 50), { kind: 'OVER', deltaHours: 2 })
    assert.deepEqual(computeEnvelopeBalance(10, 10), { kind: 'REMAINING', deltaHours: 0 })
    assert.deepEqual(computeEnvelopeBalance(0.1 + 0.2, 0.3), { kind: 'REMAINING', deltaHours: 0 })
  })

  it('compare avancement et consommation du budget en points affichés', () => {
    assert.equal(computeTrend(70.7, 63.3), 'AHEAD')
    assert.equal(computeTrend(50.2, 49.8), 'ON_TRACK')
    assert.equal(computeTrend(40, 63.3), 'BEHIND')
  })
})

describe('journal d’avancement horodaté', () => {
  it('formate une entrée comme dans la maquette', () => {
    const entry = formatLogEntry(
      { text: 'Mise en place du hook `post-commit`.', at: new Date('2026-10-18T14:30:00Z'), hours: 4.5 },
      'Europe/Paris',
    )
    assert.equal(entry, '> **18 Oct 2026 - 16h30 (4.5h passées) :** Mise en place du hook `post-commit`.')
  })

  it('garde les lignes suivantes dans la citation et ajoute en fin de journal', () => {
    const entry = formatLogEntry({ text: 'Ligne 1\n\n- point A', at: new Date('2026-01-05T08:05:00Z') }, 'UTC')
    assert.equal(entry, '> **05 Janv 2026 - 08h05 :** Ligne 1\n>\n> - point A')
    assert.equal(appendLogEntry('', entry), entry)
    assert.equal(appendLogEntry('> ancienne entrée\n\n', entry), `> ancienne entrée\n\n${entry}`)
  })
})

describe('dates calendaires', () => {
  it('stocke les dates à 00:00 UTC et refuse les dates inexistantes', () => {
    assert.equal(parseDateOnly('2026-10-18').toISOString(), '2026-10-18T00:00:00.000Z')
    assert.equal(formatDateOnly(parseDateOnly('2026-02-28')), '2026-02-28')
    assert.throws(() => parseDateOnly('2026-02-30'), RangeError)
    assert.throws(() => parseDateOnly('18/10/2026'), RangeError)
  })

  it('donne la date du jour dans le fuseau demandé', () => {
    const lateEvening = new Date('2026-10-17T22:30:00Z')
    assert.equal(todayDateOnly('UTC', lateEvening), '2026-10-17')
    assert.equal(todayDateOnly('Europe/Paris', lateEvening), '2026-10-18')
  })
})

describe('hiérarchie', () => {
  it('numérote phases et epics sur le projet, stories par epic', () => {
    const codes = computeCodes([
      { id: 20, position: 2, epics: [{ id: 200, position: 1, stories: [{ id: 2000, position: 1 }] }] },
      {
        id: 10,
        position: 1,
        epics: [{ id: 100, position: 1, stories: [{ id: 1001, position: 2 }, { id: 1000, position: 1 }] }],
      },
    ])
    assert.equal(codes.phases.get(10), '1')
    assert.equal(codes.phases.get(20), '2')
    assert.equal(codes.epics.get(100), '1')
    assert.equal(codes.epics.get(200), '2')
    assert.equal(codes.stories.get(1000), '1.1')
    assert.equal(codes.stories.get(1001), '1.2')
    assert.equal(codes.stories.get(2000), '2.1')
  })

  it('calcule la plage effective d’une barre de Gantt', () => {
    const own = (start: string | null, due: string | null) => ({
      startDate: start ? parseDateOnly(start) : null,
      dueDate: due ? parseDateOnly(due) : null,
    })
    const children = [
      { start: '2026-10-05', end: '2026-10-09' },
      null,
      { start: '2026-10-01', end: '2026-10-06' },
    ]
    assert.deepEqual(enclosingSpan(children), { start: '2026-10-01', end: '2026-10-09' })
    assert.deepEqual(effectiveSpan(own(null, null), children), { start: '2026-10-01', end: '2026-10-09' })
    assert.deepEqual(effectiveSpan(own('2026-10-02', null), children), { start: '2026-10-02', end: '2026-10-09' })
    assert.deepEqual(effectiveSpan(own(null, '2026-11-02')), { start: '2026-11-02', end: '2026-11-02' })
    assert.equal(effectiveSpan(own(null, null)), null)
  })
})

describe('slugs de projet', () => {
  it('produit un slug lisible et unique', () => {
    assert.equal(slugify('App E-Commerce v2'), 'app-e-commerce-v2')
    assert.equal(slugify('  Équipe Données & IA  '), 'equipe-donnees-ia')
    assert.equal(slugify('!!!'), 'projet')
    const taken = new Set(['demo', 'demo-2'])
    assert.equal(uniqueSlug('demo', (slug) => taken.has(slug)), 'demo-3')
    assert.equal(uniqueSlug('libre', (slug) => taken.has(slug)), 'libre')
  })
})
