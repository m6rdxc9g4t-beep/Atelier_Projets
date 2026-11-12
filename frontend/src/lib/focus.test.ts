/// <reference types="node" />
// Focus des fenêtres modales. Lancé par `npm test` (node --test).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { initialTarget, trapTarget } from './focus.ts'

const [close, select, load] = ['fermer', 'histoire', 'charger']
const all = [close, select, load]

describe('piège de focus d’une fenêtre modale', () => {
  it('boucle du dernier élément au premier, et l’inverse avec Maj', () => {
    assert.equal(trapTarget(all, load, true, false), close)
    assert.equal(trapTarget(all, close, true, true), load)
  })

  it('laisse le navigateur avancer entre deux éléments de la fenêtre', () => {
    assert.equal(trapTarget(all, select, true, false), null)
    assert.equal(trapTarget(all, select, true, true), null)
    assert.equal(trapTarget(all, close, true, false), null)
    assert.equal(trapTarget(all, load, true, true), null)
  })

  it('ramène dans la fenêtre un focus qui en est sorti (bouton désactivé ou remplacé)', () => {
    assert.equal(trapTarget(all, null, false, false), close)
    assert.equal(trapTarget(all, null, false, true), load)
    assert.equal(trapTarget(all, 'bouton de la barre latérale', false, false), close)
  })

  it('ne fait rien dans une fenêtre sans élément focalisable', () => {
    assert.equal(trapTarget([], null, false, false), null)
    assert.equal(trapTarget([], null, true, true), null)
  })

  it('avec un seul élément, le focus y reste', () => {
    assert.equal(trapTarget([close], close, true, false), close)
    assert.equal(trapTarget([close], close, true, true), close)
  })
})

describe('focus à l’ouverture', () => {
  it('va au premier champ ou bouton du contenu', () => {
    assert.equal(initialTarget(select, close), select)
  })

  it('va à « Fermer » tant que le contenu n’a rien à focaliser', () => {
    assert.equal(initialTarget(null, close), close)
    assert.equal(initialTarget(undefined, close), close)
  })

  it('ne renvoie rien sans aucun élément', () => {
    assert.equal(initialTarget(null, null), null)
  })
})
