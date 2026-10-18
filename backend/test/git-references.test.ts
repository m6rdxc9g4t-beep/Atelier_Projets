// Tests unitaires du git-engine : regex des références, numéro de branche, statut des PR, contenu du hook.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hookMarkers, withHookBlock, withoutHookBlock } from '../src/git-engine/hook.ts'
import { branchWorkItemId, commitReferences, parseReferences, pullRequestStatus } from '../src/git-engine/references.ts'

describe('références #ID (regex CLAUDE.md §3.3)', () => {
  it('reconnaît les mots-clés, sans tenir compte de la casse', () => {
    assert.deepEqual(parseReferences('feat: add regex parser for feature #12345 in git-engine'), [
      { workItemId: 12345, keyword: 'feature' },
    ])
    assert.deepEqual(parseReferences('fix(api): allow credentials bug #103 ref #102'), [
      { workItemId: 103, keyword: 'bug' },
      { workItemId: 102, keyword: 'ref' },
    ])
    assert.deepEqual(parseReferences('TASK #7 et Fix #8 et FEAT#9'), [
      { workItemId: 7, keyword: 'task' },
      { workItemId: 8, keyword: 'fix' },
      { workItemId: 9, keyword: 'feat' },
    ])
  })

  it('accepte un #ID seul et dédoublonne en gardant le premier mot-clé', () => {
    assert.deepEqual(parseReferences('Voir #42'), [{ workItemId: 42, keyword: null }])
    assert.deepEqual(parseReferences('#5 puis bug #5 puis ref #5'), [{ workItemId: 5, keyword: 'bug' }])
    assert.deepEqual(parseReferences('ref #5\nfix #5'), [{ workItemId: 5, keyword: 'ref' }])
  })

  it('ignore les #ID impossibles et les textes sans référence', () => {
    assert.deepEqual(parseReferences('#0 et #99999999999'), [])
    assert.deepEqual(parseReferences('chore: initial commit'), [])
    assert.deepEqual(parseReferences(''), [])
  })
})

describe('numéro porté par une branche', () => {
  it('lit le numéro en tête d’un segment', () => {
    assert.equal(branchWorkItemId('feature/12345-git-sync-engine'), 12345)
    assert.equal(branchWorkItemId('bug/103'), 103)
    assert.equal(branchWorkItemId('204_dark-mode'), 204)
    assert.equal(branchWorkItemId('main'), null)
    assert.equal(branchWorkItemId('release/v2.1'), null)
    assert.equal(branchWorkItemId('feature/login-2'), null)
  })
})

describe('statut affiché d’une Pull Request', () => {
  it('suit l’état GitHub', () => {
    assert.equal(pullRequestStatus({ state: 'OPEN', draft: false }), 'IN_REVIEW')
    assert.equal(pullRequestStatus({ state: 'OPEN', draft: true }), 'IN_PROGRESS')
    assert.equal(pullRequestStatus({ state: 'MERGED', draft: false }), 'CLOSED')
    assert.equal(pullRequestStatus({ state: 'CLOSED', draft: false }), 'REJECTED')
  })
})

describe('contenu du hook post-commit', () => {
  const url = 'http://127.0.0.1:3000/api/projects/1/git/scan'
  const { begin, end } = hookMarkers(1)

  it('crée un script shell avec le bloc balisé du projet', () => {
    const content = withHookBlock(null, 1, url)
    assert.ok(content.startsWith(`#!/bin/sh\n${begin}\n`))
    assert.ok(content.includes(end))
    assert.ok(content.includes(`curl -fsS -m 5 -X POST '${url}' >/dev/null 2>&1 &`))
    assert.equal(withoutHookBlock(content, 1), null)
  })

  it('place le bloc après le shebang, sans doublon, et conserve le hook existant', () => {
    const custom = '#!/usr/bin/env bash\nnpm run lint\nexit 0\n'
    const once = withHookBlock(custom, 1, url)
    assert.equal(withHookBlock(once, 1, url), once)
    assert.equal(once.split(begin).length, 2)
    assert.ok(once.indexOf(begin) < once.indexOf('exit 0'))
    assert.equal(withoutHookBlock(once, 1), custom)
  })

  it('laisse coexister les blocs de plusieurs projets', () => {
    const both = withHookBlock(withHookBlock(null, 1, url), 2, url.replace('/1/', '/2/'))
    assert.ok(both.includes(begin) && both.includes(hookMarkers(2).begin))
    const onlyTwo = withoutHookBlock(both, 1)
    assert.ok(onlyTwo !== null && !onlyTwo.includes(begin) && onlyTwo.includes(hookMarkers(2).begin))
  })

  it('refuse un hook existant qui n’est pas un script shell', () => {
    assert.throws(() => withHookBlock('#!/usr/bin/env python3\nprint("x")\n', 1, url), /pas un script shell/)
    assert.ok(withHookBlock('echo sans shebang\n', 1, url).startsWith(begin))
  })
})

describe('références d’un message de commit', () => {
  it('ignore le suffixe « (#N) » ajouté par GitHub au titre d’un squash', () => {
    assert.deepEqual(commitReferences('feat: export CSV task #3 (#57)'), [{ workItemId: 3, keyword: 'task' }])
    assert.deepEqual(commitReferences('Fix cart (#57)\n\nCloses bug #2'), [{ workItemId: 2, keyword: 'bug' }])
    assert.deepEqual(commitReferences('ref #57 au milieu du titre'), [{ workItemId: 57, keyword: 'ref' }])
  })
})
