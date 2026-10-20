// Suite Atelier (docs/SUITE.md §3) : une adresse d'une autre app de la suite ouvre l'application installée
// (`/usr/bin/open -b <identifiant>`, macOS) ; sinon, ou en cas d'échec, l'adresse part dans le navigateur.
// Logique pure, dépendances injectables : testée sans Electron (test/suite-launch.test.cjs).
'use strict'

/** Identifiants des apps de bureau, par port de leur interface (liste fermée). */
const SUITE_BUNDLES = Object.freeze({
  8000: 'fr.atelier-viz.app',
  4175: 'fr.atelier.tab',
  4174: 'local.atelier-projets.desktop',
})

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

/** Identifiant de l'app de bureau pour une adresse de la suite, sinon null. */
function suiteBundleFor(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' || !LOCAL_HOSTS.has(parsed.hostname)) return null
  return SUITE_BUNDLES[parsed.port] ?? null
}

/**
 * Ouvre une adresse externe : l'app de bureau de la suite si elle est reconnue et installée (macOS),
 * le navigateur par défaut sinon. Renvoie 'app' ou 'browser'.
 */
function openSuiteOrExternal(url, deps) {
  const { execFile, openExternal, platform = process.platform } = deps
  const bundle = suiteBundleFor(url)
  if (!bundle || platform !== 'darwin') {
    return Promise.resolve(openExternal(url)).then(() => 'browser')
  }
  return new Promise((resolve) => {
    execFile('/usr/bin/open', ['-b', bundle], (error) => {
      if (!error) return resolve('app')
      Promise.resolve(openExternal(url)).then(
        () => resolve('browser'),
        () => resolve('browser'),
      )
    })
  })
}

module.exports = { SUITE_BUNDLES, suiteBundleFor, openSuiteOrExternal }
