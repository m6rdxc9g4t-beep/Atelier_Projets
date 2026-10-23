/// <reference types="node" />
// Découpage d'un dépôt GitHub collé dans le formulaire de projet. Lancé par `npm test` (node --test).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { splitGithubRef, withGithubInput } from './github.ts'

describe('splitGithubRef', () => {
  it('reconnaît les adresses du navigateur, de clonage et « propriétaire/dépôt »', () => {
    const expected = { owner: 'octocat', repo: 'atelier-tab' }
    for (const value of [
      'https://github.com/octocat/atelier-tab',
      'https://github.com/octocat/atelier-tab/',
      'github.com/octocat/atelier-tab.git',
      'https://www.github.com/octocat/atelier-tab/tree/main/src?tab=readme#top',
      'git@github.com:octocat/atelier-tab.git',
      '  octocat/atelier-tab  ',
    ]) {
      assert.deepEqual(splitGithubRef(value), expected, value)
    }
    assert.deepEqual(splitGithubRef('https://github.com/Org-1/my.repo_v2.git'), { owner: 'Org-1', repo: 'my.repo_v2' })
  })

  it('laisse les saisies simples et les autres adresses telles quelles', () => {
    for (const value of ['atelier-tab', 'octocat', '', 'https://gitlab.com/a/b', 'a/b/c', 'https://github.com/seul']) {
      assert.equal(splitGithubRef(value), null, value)
    }
  })
})

describe('withGithubInput', () => {
  const form = { name: 'P', githubOwner: '', githubRepo: '' }
  it('une adresse collée dans l’un des champs remplit les deux', () => {
    assert.deepEqual(withGithubInput(form, 'githubRepo', 'https://github.com/octocat/hello-world'), {
      name: 'P',
      githubOwner: 'octocat',
      githubRepo: 'hello-world',
    })
    assert.deepEqual(withGithubInput(form, 'githubOwner', 'octocat/hello-world'), {
      name: 'P',
      githubOwner: 'octocat',
      githubRepo: 'hello-world',
    })
  })
  it('une saisie simple ne change que son champ', () => {
    assert.deepEqual(withGithubInput({ ...form, githubOwner: 'octocat' }, 'githubRepo', 'hello'), {
      name: 'P',
      githubOwner: 'octocat',
      githubRepo: 'hello',
    })
  })
})
