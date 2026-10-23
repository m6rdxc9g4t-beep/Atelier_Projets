// Rôles item_type et time_spent de l'import Atelier Tab (docs/SUITE.md §4.1) : règles pures, sans base.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ATELIER_MAPPINGS, matchWorkItemType, planAtelierTabImport, type DataflowEnvelope } from '../src/domain/atelier-tab.ts'

function cell(text: string | number | null) {
  return { raw: text === null ? '' : String(text), computed: text }
}

/** Export OpenProject réimporté dans Tab : titre, type, temps passé (heures), dates. */
function openProject(rows: [title: string, type: string, spent: string | number | null, start: string | null, due: string | null][]): DataflowEnvelope {
  return {
    schema_version: '2.1.0',
    workspace: { id: 'ws', name: 'Espace Ingénierie' },
    project: {
      id: 'proj_kpi',
      name: 'KPI CGO',
      source_table: { id: 'tbl_lots', name: 'Lots de travaux' },
      columns_schema: [
        { col_letter: 'A', id: 'sujet', label: 'Sujet', type: 'text', atelier_mapping: 'entity_title' },
        { col_letter: 'B', id: 'type', label: 'Type', type: 'select', atelier_mapping: 'item_type' },
        { col_letter: 'C', id: 'temps', label: 'Temps passé', type: 'number', atelier_mapping: 'time_spent' },
        { col_letter: 'D', id: 'debut', label: 'Date de début', type: 'date', atelier_mapping: 'start_date' },
        { col_letter: 'E', id: 'fin', label: 'Date de fin', type: 'date', atelier_mapping: 'due_date' },
      ],
      records: rows.map(([title, type, spent, start, due], i) => ({
        row_index: i + 1,
        record_id: `r${i + 1}`,
        values: { A: cell(title), B: cell(type), C: cell(spent), D: cell(start), E: cell(due) },
      })),
    },
  }
}

describe('rôles item_type et time_spent', () => {
  it('font partie du contrat', () => {
    assert.ok(ATELIER_MAPPINGS.includes('item_type'))
    assert.ok(ATELIER_MAPPINGS.includes('time_spent'))
  })

  it('reconnaît Feature, Task et Bug (codes, français, anglais), pas les conteneurs', () => {
    for (const [text, type] of [
      ['Feature', 'FEATURE'],
      ['fonctionnalité', 'FEATURE'],
      ['TASK', 'TASK'],
      ['Tâche', 'TASK'],
      ['Sous-tâche', 'TASK'],
      ['bug', 'BUG'],
      ['Anomalie', 'BUG'],
      ['Défaut', 'BUG'],
    ] as const) {
      assert.equal(matchWorkItemType(text), type, text)
    }
    for (const text of ['Epic', 'Story', 'User story', 'Milestone', '']) assert.equal(matchWorkItemType(text), null, text)
  })

  it('plan : type et heures par ligne, types conteneurs résumés en un avertissement', () => {
    const plan = planAtelierTabImport(
      openProject([
        ['Corrections du module Commerce', 'Epic', 79, null, null],
        ['US-001 : Afficher les trigrammes', 'Story', 3.3699999999999997, '2026-02-09', '2026-02-25'],
        ['Créer une colonne calculée', 'Feature', '0,25', '2026-02-09', '2026-02-10'],
        ['Identifier la source', 'Task', 0, '2026-02-09', '2026-02-10'],
        ['Corriger le sélecteur', 'Bug', null, null, null],
        ['Valeur bizarre', 'Task', 'beaucoup', null, null],
      ]),
    )
    assert.deepEqual(
      plan.items.map(({ type, spentHours }) => [type, spentHours]),
      [
        [null, 79],
        [null, 3.37],
        ['FEATURE', 0.25],
        ['TASK', null],
        ['BUG', null],
        ['TASK', null],
      ],
    )
    assert.deepEqual(plan.warnings, [
      'Ligne 6 : temps passé « beaucoup » illisible (nombre d’heures attendu), ignoré.',
      'Types importés selon le paramètre d’import (Task par défaut) : « Epic » (1), « Story » (1) ; seuls Feature, Task et Bug sont des éléments dans Projets.',
    ])
    // Rôles consommés : ni le type ni le temps ne sont recopiés dans le tableau de données.
    assert.doesNotMatch(plan.items[2]!.description, /Temps passé|\| Type \|/)
  })

  it('sans colonne de type ni de temps : rien ne change', () => {
    const envelope = openProject([['Lot', 'Bug', 4, null, null]])
    envelope.project.columns_schema = envelope.project.columns_schema.filter((c) => c.atelier_mapping === 'entity_title')
    const plan = planAtelierTabImport(envelope)
    assert.deepEqual(plan.items.map(({ type, spentHours }) => [type, spentHours]), [[null, null]])
  })

  it('temps négatif ou démesuré : ignoré avec avertissement', () => {
    const plan = planAtelierTabImport(openProject([['A', 'Task', -2, null, null], ['B', 'Task', 1e9, null, null]]))
    assert.deepEqual(plan.items.map((item) => item.spentHours), [null, null])
    assert.equal(plan.warnings.filter((w) => w.includes('hors limites')).length, 2)
  })
})
