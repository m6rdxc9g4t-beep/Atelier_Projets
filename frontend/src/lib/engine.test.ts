/// <reference types="node" />
// Règles du choix du moteur (docs/SUITE.md §5.2) : Claude → Auto hors ligne seulement, préférences relues du
// stockage local validées. Lancé par `npm test` (node --test), hors du build Vite.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AiStatus } from '../services/types.ts'
import { answeringEngine, effectiveChoice, restoreAiPreferences, safeEngineChoice, safeOllamaModel } from './engine.ts'

function status(onlineMode: boolean, claudeAvailable: boolean): AiStatus {
  return {
    onlineMode,
    auto: onlineMode && claudeAvailable ? 'claude' : 'ollama',
    claude: { available: claudeAvailable, error: claudeAvailable ? null : 'Claude CLI non connectée' },
  } as unknown as AiStatus
}

describe('choix effectif du moteur', () => {
  it('hors ligne : Claude retombe sur Auto (donc Ollama)', () => {
    assert.equal(effectiveChoice('claude', status(false, true)), 'auto')
    assert.equal(answeringEngine('claude', status(false, true)), 'ollama')
  })

  it('en ligne, Claude indisponible mais choisi : reste Claude (erreur claire du serveur, pas Ollama)', () => {
    assert.equal(effectiveChoice('claude', status(true, false)), 'claude')
    assert.equal(answeringEngine('claude', status(true, false)), 'claude')
  })

  it('en ligne et disponible, Auto et Ollama inchangés, état inconnu', () => {
    assert.equal(effectiveChoice('claude', status(true, true)), 'claude')
    assert.equal(answeringEngine('auto', status(true, true)), 'claude')
    assert.equal(answeringEngine('auto', status(true, false)), 'ollama')
    assert.equal(answeringEngine('ollama', status(true, true)), 'ollama')
    assert.equal(effectiveChoice('claude', null), 'claude')
    assert.equal(answeringEngine('auto', null), 'ollama')
  })
})

describe('préférences IA relues du stockage local', () => {
  it('valeurs valides gardées', () => {
    assert.deepEqual(restoreAiPreferences({ aiEngine: 'claude', claudeModel: 'opus', aiModel: 'qwen2.5-coder:7b', theme: 'dark' }), {
      aiEngine: 'claude',
      claudeModel: 'opus',
      aiModel: 'qwen2.5-coder:7b',
    })
    assert.equal(safeOllamaModel('hf.co/org/modele:Q4_K_M'), 'hf.co/org/modele:Q4_K_M')
  })

  it('valeurs inconnues ou mal typées : valeurs par défaut', () => {
    const defaults = { aiEngine: 'auto', claudeModel: 'sonnet', aiModel: null }
    assert.deepEqual(restoreAiPreferences({ aiEngine: 'gpt', claudeModel: 'claude-3', aiModel: 'x'.repeat(500) }), defaults)
    assert.deepEqual(restoreAiPreferences({ aiEngine: ['claude'], claudeModel: 1, aiModel: { name: 'qwen' } }), defaults)
    assert.deepEqual(restoreAiPreferences({ aiModel: 'modèle avec espaces\n' }), defaults)
    assert.deepEqual(restoreAiPreferences(null), defaults)
    assert.deepEqual(restoreAiPreferences('claude'), defaults)
    assert.equal(safeEngineChoice('CLAUDE'), 'auto')
    assert.equal(safeOllamaModel('  '), null)
  })
})
