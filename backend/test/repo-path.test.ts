// Chemin du dépôt local saisi par l'utilisateur (module pur, sans base de données).
import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'
import { normalizeRepoPath, RepoPathError } from '../src/domain/repo-path.ts'

describe('normalizeRepoPath', () => {
  const posix = (input: string) => normalizeRepoPath(input, '/Users/camille', path.posix)
  const win = (input: string) => normalizeRepoPath(input, 'C:\\Users\\camille', path.win32)

  it('laisse un chemin absolu tel quel', () => {
    assert.equal(posix('/Users/camille/dev/atelier'), '/Users/camille/dev/atelier')
    assert.equal(posix('/Users/camille/Mes projets/site web'), '/Users/camille/Mes projets/site web')
    assert.equal(posix('/'), '/')
    assert.equal(win('C:\\Users\\camille\\dev\\atelier'), 'C:\\Users\\camille\\dev\\atelier')
    assert.equal(win('C:\\'), 'C:\\')
  })

  it('remplace « ~ » par le dossier personnel', () => {
    assert.equal(posix('~/dev/atelier'), '/Users/camille/dev/atelier')
    assert.equal(posix('~'), '/Users/camille')
    assert.equal(win('~\\dev\\atelier'), 'C:\\Users\\camille\\dev\\atelier')
    assert.equal(win('~/dev/atelier'), 'C:\\Users\\camille\\dev\\atelier')
  })

  it('retire espaces, guillemets et barre finale', () => {
    assert.equal(posix('  /Users/camille/dev/atelier/  '), '/Users/camille/dev/atelier')
    assert.equal(posix('"/Users/camille/Mes projets/site"'), '/Users/camille/Mes projets/site')
    assert.equal(posix("'~/dev/atelier/'"), '/Users/camille/dev/atelier')
    assert.equal(win('"C:\\Users\\camille\\dev\\atelier\\"'), 'C:\\Users\\camille\\dev\\atelier')
  })

  it('refuse un chemin relatif en disant quoi saisir', () => {
    for (const input of ['dev/atelier', './atelier', '~camille/dev', 'atelier', '   ', '""']) {
      assert.throws(() => posix(input), RepoPathError, input)
    }
    assert.throws(() => posix('relatif/depot'), /chemin complet du dossier.*« \/Users\/camille\/dev\/mon-projet ».*reçu : « relatif\/depot »/)
    assert.throws(() => win('dev\\atelier'), RepoPathError)
  })
})
