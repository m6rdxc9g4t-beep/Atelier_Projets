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

  it('dit quoi corriger, avec le nom du champ tel que l’interface l’affiche', () => {
    const message = (keyword: string, instancePath: string, params: Record<string, unknown>) =>
      validationMessage([{ keyword, instancePath, params }], 'repli')
    assert.equal(message('maximum', '/hours', { comparison: '<=', limit: 24 }), 'Heures : 24 au plus.')
    assert.equal(message('minimum', '/hours', { comparison: '>=', limit: 0.01 }), 'Heures : 0,01 au moins.')
    assert.equal(message('exclusiveMinimum', '/hoursPerDay', { limit: 0 }), '« 1 jour = X heures » : doit être supérieur à 0.')
    assert.equal(message('maxLength', '/title', { limit: 200 }), 'Titre : 200 caractères au plus.')
    assert.equal(message('minLength', '/defaultBranch', { limit: 1 }), 'Branche par défaut : ne peut pas être vide.')
    assert.equal(message('minLength', '/q', { limit: 3 }), 'Recherche : 3 caractères au moins.')
    assert.equal(message('pattern', '/title', { pattern: '\\S' }), 'Titre : ne peut pas être vide.')
    assert.equal(message('format', '/dueDate', { format: 'date' }), 'Échéance : date attendue au format AAAA-MM-JJ.')
    assert.equal(message('type', '/progress', { type: 'integer' }), 'Avancement : nombre entier attendu.')
    assert.equal(message('type', '/estimatedHours', { type: ['number', 'null'] }), 'Estimation (heures) : nombre attendu.')
    assert.equal(
      message('enum', '/status', { allowedValues: ['OPEN', 'CLOSED'] }),
      'Statut : valeur non reconnue (attendu : OPEN, CLOSED).',
    )
    assert.equal(message('minItems', '/items', { limit: 1 }), 'Liste des éléments : 1 élément au moins.')
  })

  it('nomme le champ manquant, le champ inconnu et la ligne d’une liste', () => {
    assert.equal(validationMessage([{ keyword: 'required', instancePath: '', params: { missingProperty: 'hours' } }], 'x'), 'Heures : champ obligatoire.')
    assert.equal(
      validationMessage([{ keyword: 'additionalProperties', instancePath: '', params: { additionalProperty: 'inconnu' } }], 'x'),
      'Champ inconnu : « inconnu ».',
    )
    assert.equal(
      validationMessage([{ keyword: 'minLength', instancePath: '/items/1/title', params: { limit: 1 } }], 'x'),
      'Titre (ligne 2) : ne peut pas être vide.',
    )
    // Champ sans libellé : son nom technique, entre guillemets.
    assert.equal(validationMessage([{ keyword: 'maximum', instancePath: '/timeoutMs', params: { limit: 5 } }], 'x'), '« timeoutMs » : 5 au plus.')
    assert.equal(validationMessage([{ keyword: 'type', instancePath: '', params: { type: 'object' } }], 'x'), 'Requête : objet attendu.')
  })

  it('garde le message d’origine pour un mot-clé non prévu ou sans paramètre', () => {
    assert.equal(validationMessage([{ instancePath: '/githubRepo', keyword: 'anyOf' }], 'body/githubRepo must match a schema in anyOf'), 'body/githubRepo must match a schema in anyOf')
    assert.equal(validationMessage([{ instancePath: '/hours', keyword: 'maximum' }], 'brut'), 'brut')
    assert.equal(validationMessage([{ instancePath: '/x', keyword: 'format', params: { format: 'uuid' } }], 'brut'), 'brut')
    assert.equal(validationMessage([{ instancePath: '/slug', keyword: 'pattern' }], 'motif').startsWith('Identifiant du projet : minuscules'), true)
    assert.equal(validationMessage(undefined, 'brut'), 'brut')
    assert.equal(validationMessage([], 'brut'), 'brut')
  })
})
