/// <reference types="node" />
// Relecture des données au retour sur la fenêtre. Lancé par `npm test` (node --test).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createFreshness, MIN_AWAY_MS } from './freshness.ts'

function setup(busy = false) {
  const state = { refreshed: 0, busy }
  const freshness = createFreshness({ refresh: () => (state.refreshed += 1), isBusy: () => state.busy })
  return { state, freshness }
}

describe('fraîcheur des données', () => {
  it('relit au retour après une vraie absence', () => {
    const { state, freshness } = setup()
    freshness.left(1_000)
    freshness.returned(1_000 + MIN_AWAY_MS)
    assert.equal(state.refreshed, 1)
  })

  it('ne relit pas après un aller-retour éclair (sélecteur de fichier)', () => {
    const { state, freshness } = setup()
    freshness.left(1_000)
    freshness.returned(1_000 + MIN_AWAY_MS - 1)
    assert.equal(state.refreshed, 0)
  })

  it('ne relit qu’une fois quand focus et visibilité signalent le même retour', () => {
    const { state, freshness } = setup()
    freshness.left(1_000) // perte du focus
    freshness.left(4_000) // puis onglet masqué : l'absence date du premier signal
    freshness.returned(1_000 + MIN_AWAY_MS)
    freshness.returned(1_000 + MIN_AWAY_MS + 1)
    assert.equal(state.refreshed, 1)
  })

  it('ne relit pas sans départ (premier focus de la fenêtre)', () => {
    const { state, freshness } = setup()
    freshness.returned(60_000)
    assert.equal(state.refreshed, 0)
  })

  it('attend la fermeture d’un dialogue ouvert, puis relit une fois', () => {
    const { state, freshness } = setup(true)
    freshness.left(0)
    freshness.returned(60_000)
    assert.equal(state.refreshed, 0, 'la saisie en cours est gardée')
    freshness.settled()
    assert.equal(state.refreshed, 0, 'toujours ouvert')
    state.busy = false
    freshness.settled()
    freshness.settled()
    assert.equal(state.refreshed, 1)
  })

  it('une fermeture de dialogue sans retour en attente ne relit rien', () => {
    const { state, freshness } = setup()
    freshness.settled()
    assert.equal(state.refreshed, 0)
  })
})
