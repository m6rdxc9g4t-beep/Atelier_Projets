// Messages de validation en français (module pur, sans base de données).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validationMessage } from '../src/http/validation-messages.ts'

describe('validationMessage', () => {
  it('explique le format du dépôt et du propriétaire GitHub', () => {
    assert.match(
      validationMessage([{ instancePath: '/githubRepo', keyword: 'pattern' }], 'body/githubRepo must match pattern'),
      /^Dépôt GitHub : indiquez seulement le nom du dépôt/,
    )
    assert.match(validationMessage([{ instancePath: '/githubOwner', keyword: 'pattern' }], 'x'), /^Propriétaire GitHub/)
  })

  it('garde le message d’origine pour les autres erreurs', () => {
    assert.equal(validationMessage([{ instancePath: '/githubRepo', keyword: 'type' }], 'body/githubRepo must be string'), 'body/githubRepo must be string')
    assert.equal(validationMessage([{ instancePath: '/slug', keyword: 'pattern' }], 'motif'), 'motif')
    assert.equal(validationMessage(undefined, 'brut'), 'brut')
    assert.equal(validationMessage([], 'brut'), 'brut')
  })
})
