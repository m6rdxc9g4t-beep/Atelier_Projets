// Mise à jour de l'application de bureau à partir du dépôt : après un « git pull » (ou une modification locale),
// le prochain lancement réinstalle les dépendances si le lockfile a changé, applique les migrations de la base
// et recompile l'API et l'interface. Rien n'est refait si le dépôt n'a pas bougé depuis la dernière compilation.
'use strict'

const { spawn, execFileSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const STAMP = path.join('desktop', '.build-stamp.json')

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function git(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

/** État du dépôt : commit courant + modifications locales suivies + lockfile. */
function repoState(repo) {
  const head = git(repo, ['rev-parse', 'HEAD'])?.trim() ?? 'sans-git'
  // Fichiers suivis modifiés (hors dossiers générés) : leur contenu compte, pas seulement leur nom.
  const changed = (git(repo, ['diff', '--name-only', 'HEAD']) ?? '')
    .split('\n')
    .filter((file) => file && !file.startsWith('desktop/.build-stamp'))
    .sort()
  const contents = changed.map((file) => {
    try {
      return `${file}:${hash(fs.readFileSync(path.join(repo, file)))}`
    } catch {
      return `${file}:supprimé`
    }
  })
  let lock = 'absent'
  try {
    lock = hash(fs.readFileSync(path.join(repo, 'package-lock.json')))
  } catch {
    /* pas de lockfile */
  }
  return { code: hash([head, ...contents].join('\n')), lock }
}

function readStamp(repo) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repo, STAMP), 'utf8'))
  } catch {
    return null
  }
}

function built(repo) {
  return (
    fs.existsSync(path.join(repo, 'frontend', 'dist', 'index.html')) &&
    fs.existsSync(path.join(repo, 'backend', 'dist', 'server.js')) &&
    fs.existsSync(path.join(repo, 'backend', 'src', 'generated'))
  )
}

/** Étapes à faire avant de lancer l'application (vide : tout est à jour). */
function plan(repo) {
  const state = repoState(repo)
  const stamp = readStamp(repo)
  const steps = []
  const depsMissing = !fs.existsSync(path.join(repo, 'node_modules', '.package-lock.json'))
  if (depsMissing || (stamp && stamp.lock !== state.lock)) steps.push('install')
  if (steps.length > 0 || !stamp || stamp.code !== state.code || !built(repo)) steps.push('generate', 'migrate', 'build')
  else steps.push('migrate') // nouvelle base ou base remplacée par une sauvegarde : migrations toujours vérifiées
  return { state, steps }
}

const COMMANDS = {
  install: { label: 'Installation des dépendances (npm install)…', args: ['install', '--no-audit', '--no-fund'] },
  generate: { label: 'Préparation de la base (Prisma)…', args: ['run', 'db:generate', '--workspace=@atelier/backend'] },
  migrate: { label: 'Mise à jour de la base (migrations)…', args: ['run', 'db:deploy', '--workspace=@atelier/backend'] },
  build: { label: 'Compilation de l’API et de l’interface…', args: ['run', 'build'] },
}

function runNpm(repo, args, { npm = 'npm', env = process.env, logFile }) {
  return new Promise((resolve, reject) => {
    const log = fs.openSync(logFile, 'a')
    fs.writeSync(log, `\n$ npm ${args.join(' ')}\n`)
    const child = spawn(npm, args, { cwd: repo, env, stdio: ['ignore', log, log] })
    fs.closeSync(log)
    child.once('error', reject)
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`« npm ${args.join(' ')} » a échoué (code ${code}).`))))
  })
}

/** Exécute les étapes nécessaires ; onStatus reçoit un message pour l'écran de démarrage. */
async function prepare(repo, { onStatus = () => {}, npm, env, logFile }) {
  const { steps } = plan(repo)
  for (const step of steps) {
    onStatus(COMMANDS[step].label)
    await runNpm(repo, COMMANDS[step].args, { npm, env, logFile })
  }
  if (steps.includes('build')) {
    // État relu après coup : npm install peut réécrire le lockfile, qui ne doit pas déclencher une nouvelle compilation.
    const after = repoState(repo)
    fs.writeFileSync(path.join(repo, STAMP), `${JSON.stringify({ ...after, builtAt: new Date().toISOString() }, null, 2)}\n`)
  }
  return steps
}

module.exports = { prepare, plan, repoState }
