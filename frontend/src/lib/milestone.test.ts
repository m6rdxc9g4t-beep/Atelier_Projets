/// <reference types="node" />
// État affiché d'un jalon. Lancé par `npm test` (node --test).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MILESTONE_STATE_LABEL, MILESTONE_STATE_STATUS, milestoneState } from './milestone.ts'

describe('état d’un jalon', () => {
  it('atteint, quelle que soit sa date', () => {
    assert.equal(milestoneState({ date: '2026-10-15', reached: true }, '2026-11-11'), 'reached')
    assert.equal(milestoneState({ date: '2026-12-01', reached: true }, '2026-11-11'), 'reached')
  })

  it('en retard dès le lendemain de sa date, s’il n’est pas atteint', () => {
    assert.equal(milestoneState({ date: '2026-11-02', reached: false }, '2026-11-11'), 'late')
    assert.equal(milestoneState({ date: '2026-11-10', reached: false }, '2026-11-11'), 'late')
    assert.equal(milestoneState({ date: '2025-12-31', reached: false }, '2026-01-01'), 'late')
  })

  it('à venir le jour même et après', () => {
    assert.equal(milestoneState({ date: '2026-11-11', reached: false }, '2026-11-11'), 'upcoming')
    assert.equal(milestoneState({ date: '2026-11-16', reached: false }, '2026-11-11'), 'upcoming')
  })

  it('accepte une date suivie d’une heure', () => {
    assert.equal(milestoneState({ date: '2026-11-11T00:00:00.000Z', reached: false }, '2026-11-11'), 'upcoming')
  })

  it('le retard est le seul état signalé comme anormal', () => {
    assert.equal(MILESTONE_STATE_LABEL.late, 'En retard')
    assert.deepEqual(MILESTONE_STATE_STATUS, { reached: 'CLOSED', late: 'BLOCKED', upcoming: 'OPEN' })
  })
})
