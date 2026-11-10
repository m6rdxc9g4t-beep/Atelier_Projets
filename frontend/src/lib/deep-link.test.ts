/// <reference types="node" />
// Lien profond d'Atelier Hub. Lancé par `npm test` (node --test).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readDeepLink, withoutDeepLink } from './deep-link.ts'

describe('lien profond', () => {
  it('lit le projet et l’élément', () => {
    assert.deepEqual(readDeepLink('?projet=4&element=103'), { projectId: 4, workItemId: 103 })
    assert.deepEqual(readDeepLink('?projet=4'), { projectId: 4, workItemId: null })
  })

  it('ignore un lien incomplet ou invalide', () => {
    assert.equal(readDeepLink(''), null)
    assert.equal(readDeepLink('?element=103'), null)
    assert.equal(readDeepLink('?projet=abc'), null)
    assert.equal(readDeepLink('?projet=0'), null)
    assert.deepEqual(readDeepLink('?projet=4&element=-1'), { projectId: 4, workItemId: null })
  })

  it('retire seulement ses paramètres de l’adresse', () => {
    assert.equal(withoutDeepLink('https://projets.exemple.fr/?projet=4&element=103'), '/')
    assert.equal(withoutDeepLink('http://127.0.0.1:4174/?a=1&projet=4#x'), '/?a=1#x')
  })
})
