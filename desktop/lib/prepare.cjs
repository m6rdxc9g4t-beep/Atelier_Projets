// Mise à jour de l'application de bureau à partir du dépôt (docs/SUITE.md §8) : après un « git pull » (ou une
// modification locale), le prochain lancement réinstalle les dépendances depuis le lockfile si elles ont changé
// (npm ci), applique les migrations de la base (copie de sauvegarde d'abord s'il y en a en attente : script npm
// predb:deploy du backend) et recompile l'API et l'interface. Rien n'est refait si le dépôt n'a pas bougé.
//
// Garde-fous : une seule mise à jour à la fois (verrou desktop/.update.lock) ; la version précédente (dépendances et
// compilation) reste utilisable jusqu'à la réussite complète : node_modules est mis de côté pendant npm ci, l'API et
// l'interface sont compilées à part (dist.maj) puis échangées avec dist ; en cas d'échec, tout est remis en place et
// l'erreur (UpdateError) dit si l'application peut s'ouvrir avec la version précédente. Le tampon n'est écrit
// qu'après une mise à jour entièrement réussie.
//
// Windows (docs/SUITE.md §9.3) : npm lancé sans shell (node.exe + npm-cli.js, lib/node-path.cjs), aucune fenêtre de
// console ; un dossier dont un fichier est ouvert par un autre programme (antivirus, indexation, « npm run dev ») ne
// peut être ni renommé ni supprimé : les renommages sont réessayés quelques secondes, puis l'étape échoue en
// remettant la version précédente en place ; les suppressions en échec sont reprises au lancement suivant.
// Les variables héritées d'une autre app (DATABASE_URL…) ne passent jamais à npm (lib/environment.cjs, §9.4).
'use strict'

const { spawn, execFileSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { desktopEnvironment, ignoredMessage } = require('./environment.cjs')
const { npmCommand } = require('./node-path.cjs')

const STAMP = path.join('desktop', '.build-stamp.json')
const LOCK = path.join('desktop', '.update.lock')
/** Suffixes des dossiers mis de côté pendant une mise à jour (ignorés par git). */
const PREVIOUS = '.avant-maj'
const DISCARD = '.a-supprimer'
const STAGING = 'dist.maj'
/** Compilations produites, dans l'ordre : chaque dossier est compilé à part puis échangé avec dist. */
const OUTPUTS = [
  { workspace: '@atelier/backend', dir: 'backend', check: 'server.js' },
  { workspace: '@atelier/frontend', dir: 'frontend', check: 'index.html' },
]
const LOG_MAX_BYTES = 2 * 1024 * 1024

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function git(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
  } catch {
    return null
  }
}

/**
 * Chemins listés par « git status --porcelain=v1 -z » : fichiers suivis modifiés et fichiers nouveaux non ignorés
 * (docs/SUITE.md §8.4) ; pour un renommage, le nouveau chemin seulement.
 */
function parsePorcelain(output) {
  const entries = output.split('\0')
  const files = []
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]
    if (entry.length < 4) continue
    files.push(entry.slice(3))
    if (entry[0] === 'R' || entry[0] === 'C') i += 1 // chemin d'origine du renommage
  }
  return files
}

/** État du dépôt : commit courant + modifications locales (suivies et nouveaux fichiers) + lockfile. */
function repoState(repo) {
  const head = git(repo, ['rev-parse', 'HEAD'])?.trim() ?? 'sans-git'
  // Fichiers modifiés ou nouveaux (hors fichiers ignorés) : leur contenu compte, pas seulement leur nom.
  const changed = [...new Set(parsePorcelain(git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all']) ?? ''))]
    .filter((file) => !file.startsWith('desktop/.build-stamp'))
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

function depsInstalled(repo) {
  return fs.existsSync(path.join(repo, 'node_modules', '.package-lock.json'))
}

function built(repo) {
  return (
    OUTPUTS.every((output) => fs.existsSync(path.join(repo, output.dir, 'dist', output.check))) &&
    fs.existsSync(path.join(repo, 'backend', 'src', 'generated'))
  )
}

/** Une version compilée précédente peut-elle s'ouvrir (compilation et dépendances présentes) ? */
function previousBuildUsable(repo) {
  return depsInstalled(repo) && OUTPUTS.every((output) => fs.existsSync(path.join(repo, output.dir, 'dist', output.check)))
}

/** Étapes à faire avant de lancer l'application (« migrate » seule : tout est à jour). */
function plan(repo) {
  const state = repoState(repo)
  const stamp = readStamp(repo)
  const steps = []
  // Sans tampon (premier lancement, ou mise à jour jamais réussie), rien ne garantit que node_modules suit le
  // lockfile : installation complète (docs/SUITE.md §8.4).
  if (!stamp || !depsInstalled(repo) || stamp.lock !== state.lock) steps.push('install')
  if (steps.length > 0 || !stamp || stamp.code !== state.code || !built(repo)) steps.push('generate', 'migrate', 'build')
  else steps.push('migrate') // nouvelle base ou base remplacée par une sauvegarde : migrations toujours vérifiées
  return { state, steps }
}

const STEPS = {
  install: {
    label: 'Installation des dépendances (npm ci)…',
    name: 'Installation des dépendances',
    hint: 'Vérifiez la connexion au registre npm et que package-lock.json correspond aux package.json (npm ci ne le réécrit jamais).',
  },
  generate: { label: 'Préparation de la base (Prisma)…', name: 'Préparation du client Prisma', hint: '' },
  migrate: {
    label: 'Mise à jour de la base (migrations)…',
    name: 'Mise à jour de la base',
    hint: 'Si des migrations étaient en attente, une copie de la base a été faite juste avant (sauvegarde « avant migration », par défaut dans backend/prisma/backups ; chemin exact dans le journal).',
  },
  build: { label: 'Compilation de l’API et de l’interface…', name: 'Compilation', hint: '' },
}

const INSTALL_ARGS = ['ci', '--include=dev', '--no-audit', '--no-fund']

/** Échec d'une mise à jour : message en français, journal, et possibilité d'ouvrir la version précédente. */
class UpdateError extends Error {
  constructor({ step, detail, logFile, canUsePrevious, cause }) {
    const what = STEPS[step]?.name ?? 'Mise à jour'
    super(`La mise à jour a échoué à l’étape « ${what} » : ${detail}`, cause ? { cause } : undefined)
    this.name = 'UpdateError'
    this.step = step
    this.hint = STEPS[step]?.hint ?? ''
    this.logFile = logFile
    this.canUsePrevious = canUsePrevious
  }
}

function appendLog(logFile, text) {
  try {
    fs.appendFileSync(logFile, text)
  } catch {
    /* journal facultatif */
  }
}

/** Le journal ne grossit pas sans fin : au-delà de 2 Mo, il devient mise-a-jour.1.log (une génération gardée). */
function rotateLog(logFile, maxBytes = LOG_MAX_BYTES) {
  try {
    if (fs.statSync(logFile).size > maxBytes) fs.renameSync(logFile, logFile.replace(/(\.log)?$/, '.1.log'))
  } catch {
    /* pas encore de journal */
  }
}

/** Commande npm [exécutable, ...arguments] : `npm` donné (chaîne ou tableau), sinon cherchée dans le PATH de `env`. */
function resolveNpm(npm, env) {
  if (Array.isArray(npm)) return npm
  if (typeof npm === 'string') return [npm]
  return npmCommand({ env })
}

function runNpm(repo, args, { npm, env = process.env, logFile }) {
  return new Promise((resolve, reject) => {
    appendLog(logFile, `\n$ npm ${args.join(' ')}\n`)
    const command = resolveNpm(npm, env)
    if (!command) return reject(new Error('npm introuvable (Node.js est-il installé ?)'))
    const log = fs.openSync(logFile, 'a')
    let child
    try {
      // Sans shell : arguments passés tels quels (chemins avec espaces ou accents compris) ; aucune console sous Windows.
      child = spawn(command[0], [...command.slice(1), ...args], { cwd: repo, env, stdio: ['ignore', log, log], windowsHide: true })
    } finally {
      fs.closeSync(log)
    }
    child.once('error', (error) =>
      reject(error.code === 'ENOENT' ? new Error('npm introuvable (Node.js est-il installé ?)', { cause: error }) : error),
    )
    child.once('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`« npm ${args.join(' ')} » s’est arrêté (${code === null ? signal : `code ${code}`}).`)),
    )
  })
}

// --- Verrou -------------------------------------------------------------------------------------------

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * Prend le verrou de mise à jour du dépôt (fichier créé de façon exclusive). Tant qu'une autre mise à jour vivante
 * le tient, attend (onWait) ; un verrou abandonné (processus arrêté, ou plus vieux que staleMs) est repris.
 * Renvoie la fonction qui le relâche.
 */
async function acquireLock(repo, { onWait = () => {}, pollMs = 500, staleMs = 30 * 60_000, timeoutMs = 60 * 60_000, now = Date.now } = {}) {
  const file = path.join(repo, LOCK)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const owner = JSON.stringify({ pid: process.pid, since: new Date(now()).toISOString() })
  const started = now()
  let waiting = false
  for (;;) {
    try {
      fs.writeFileSync(file, owner, { flag: 'wx' })
      return () => {
        try {
          if (fs.readFileSync(file, 'utf8') === owner) fs.unlinkSync(file)
        } catch {
          /* déjà relâché */
        }
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    let holder = null
    let age = 0
    try {
      holder = JSON.parse(fs.readFileSync(file, 'utf8'))
      age = now() - Date.parse(holder.since)
    } catch {
      // Verrou illisible : en cours d'écriture par son propriétaire, ou laissé vide par un arrêt brutal.
      try {
        age = now() - fs.statSync(file).mtimeMs
      } catch {
        continue // relâché entre-temps
      }
      holder = age > 10_000 ? null : { pid: process.pid }
    }
    if (!holder || !Number.isInteger(holder.pid) || !pidAlive(holder.pid) || age > staleMs) {
      fs.rmSync(file, { force: true })
      continue
    }
    if (now() - started > timeoutMs) throw new Error('Une autre mise à jour d’Atelier Projets ne se termine pas (verrou desktop/.update.lock).')
    if (!waiting) onWait()
    waiting = true
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

// --- Renommages et suppressions sûrs (Windows : fichiers verrouillés) --------------------------------------------

/** Codes d'un fichier momentanément verrouillé (antivirus, indexation) ou utilisé par un autre programme. */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'])

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Renomme en réessayant tant que la cible est verrouillée (jusqu'à ~5 s sous Windows) ; l'erreur finale dit qu'un
 * autre programme utilise le dossier (la mise à jour échoue alors proprement, version précédente remise en place).
 */
function renameRetry(from, to, { attempts = process.platform === 'win32' ? 12 : 1, delayMs = 100, rename = fs.renameSync, wait = pause } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return rename(from, to)
    } catch (error) {
      if (!BUSY.has(error.code) || attempt >= attempts) {
        if (BUSY.has(error.code)) {
          throw new Error(
            `« ${from} » est utilisé par un autre programme (fenêtre d’Atelier Projets, « npm run dev », éditeur, antivirus) : le fermer puis réessayer.`,
            { cause: error },
          )
        }
        throw error
      }
      wait(Math.min(delayMs * attempt, 1000))
    }
  }
}

/** Suppression récursive, réessayée sur un fichier verrouillé (Windows). */
function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: process.platform === 'win32' ? 5 : 0, retryDelay: 200 })
}

// --- Version précédente mise de côté ------------------------------------------------------------------

/** Dossiers node_modules du dépôt (racine et workspaces) : npm ci les vide tous. */
function moduleDirs(repo) {
  let workspaces = []
  try {
    workspaces = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).workspaces ?? []
  } catch {
    /* pas de workspaces */
  }
  return ['.', ...workspaces].map((dir) => path.join(repo, dir, 'node_modules'))
}

function outputDirs(repo) {
  return OUTPUTS.map((output) => path.join(repo, output.dir, 'dist'))
}

/** Met un dossier de côté (renommage, instantané) : il pourra être remis en place ou supprimé. */
function setAside(dir) {
  if (!fs.existsSync(dir)) return
  removeDir(dir + PREVIOUS)
  renameRetry(dir, dir + PREVIOUS)
}

/** Remet en place un dossier mis de côté ; la version partielle éventuelle part à la suppression. */
function restore(dir) {
  if (!fs.existsSync(dir + PREVIOUS)) return
  if (fs.existsSync(dir)) {
    removeDir(dir + DISCARD)
    renameRetry(dir, dir + DISCARD)
  }
  renameRetry(dir + PREVIOUS, dir)
}

/** Après réussite : la version précédente part à la suppression (renommage d'abord, pour ne jamais la restaurer à moitié). */
function discardPrevious(dir) {
  if (!fs.existsSync(dir + PREVIOUS)) return
  removeDir(dir + DISCARD)
  renameRetry(dir + PREVIOUS, dir + DISCARD)
}

function purgeDiscarded(repo) {
  return Promise.all(
    [...moduleDirs(repo), ...outputDirs(repo)].map((dir) => fs.promises.rm(dir + DISCARD, { recursive: true, force: true })),
  )
}

/**
 * Mise à jour interrompue (application quittée, panne) : la version précédente encore de côté est remise en place,
 * les compilations partielles sont supprimées. Le tampon n'ayant pas été écrit, la mise à jour sera refaite.
 */
function recover(repo) {
  const restored = []
  for (const dir of [...moduleDirs(repo), ...outputDirs(repo)]) {
    if (fs.existsSync(dir + PREVIOUS)) {
      restore(dir)
      restored.push(path.relative(repo, dir))
    }
  }
  for (const output of OUTPUTS) removeDir(path.join(repo, output.dir, STAGING))
  return restored
}

// --- Mise à jour --------------------------------------------------------------------------------------

async function install(repo, options) {
  // Sous Windows, un module natif chargé (better-sqlite3, moteur Prisma) verrouille node_modules : l'erreur le dit.
  for (const dir of moduleDirs(repo)) setAside(dir)
  await runNpm(repo, INSTALL_ARGS, options)
}

/** Compile l'API et l'interface à part (dist.maj), puis les échange avec dist une fois les deux réussies. */
async function build(repo, options) {
  for (const output of OUTPUTS) {
    const staging = path.join(repo, output.dir, STAGING)
    removeDir(staging)
    await runNpm(repo, ['run', 'build', `--workspace=${output.workspace}`, '--', '--outDir', STAGING], options)
    if (!fs.existsSync(path.join(staging, output.check))) {
      throw new Error(`compilation incomplète : ${path.join(output.dir, STAGING, output.check)} absent.`)
    }
  }
  for (const output of OUTPUTS) {
    const dist = path.join(repo, output.dir, 'dist')
    setAside(dist)
    renameRetry(path.join(repo, output.dir, STAGING), dist)
  }
}

/**
 * Exécute les étapes nécessaires sous le verrou ; onStatus reçoit un message pour l'écran de démarrage.
 * Renvoie les étapes faites ; rejette avec une UpdateError (version précédente remise en place).
 */
async function prepare(repo, { onStatus = () => {}, npm, env = process.env, logFile, lockOptions = {} }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  rotateLog(logFile)
  // Variables d'une autre app (DATABASE_URL de Nexus…) : jamais transmises à npm (sauvegarde, migrations, compilation).
  const { env: npmEnv, ignored } = desktopEnvironment(env)
  const release = await acquireLock(repo, {
    ...lockOptions,
    onWait: () => onStatus('Une autre mise à jour d’Atelier Projets est en cours : attente de sa fin…'),
  })
  try {
    const restored = recover(repo)
    // Plan établi sous le verrou : une mise à jour concurrente a pu tout faire entre-temps.
    const { state, steps } = plan(repo)
    const date = new Date().toLocaleString('fr-FR')
    appendLog(
      logFile,
      steps.length > 1 ? `\n===== Mise à jour du ${date} — dépôt ${repo} =====\nÉtapes : ${steps.join(', ')}\n` : `\n--- Lancement du ${date} : dépôt à jour, migrations vérifiées ---\n`,
    )
    if (restored.length > 0) appendLog(logFile, `Mise à jour précédente interrompue : remis en place ${restored.join(', ')}.\n`)
    if (ignored.length > 0) appendLog(logFile, `${ignoredMessage(ignored)}\n`)
    const options = { npm, env: npmEnv, logFile }
    for (const step of steps) {
      onStatus(STEPS[step].label)
      try {
        if (step === 'install') await install(repo, options)
        else if (step === 'build') await build(repo, options)
        else await runNpm(repo, ['run', step === 'generate' ? 'db:generate' : 'db:deploy', '--workspace=@atelier/backend'], options)
      } catch (error) {
        try {
          recover(repo)
        } catch (recoverError) {
          appendLog(logFile, `Remise en place incomplète (reprise au prochain lancement) : ${recoverError.message}\n`)
        }
        const canUsePrevious = previousBuildUsable(repo)
        appendLog(logFile, `✘ Échec (${step}) : ${error.message}${canUsePrevious ? '\n  Version précédente remise en place.' : ''}\n`)
        throw new UpdateError({ step, detail: error.message, logFile, canUsePrevious, cause: error })
      }
    }
    if (steps.includes('build')) {
      for (const dir of [...moduleDirs(repo), ...outputDirs(repo)]) discardPrevious(dir)
      // État d'avant la mise à jour : un fichier modifié pendant la compilation déclenchera la suivante.
      fs.writeFileSync(path.join(repo, STAMP), `${JSON.stringify({ ...state, builtAt: new Date().toISOString() }, null, 2)}\n`)
      appendLog(logFile, '✔ Mise à jour terminée.\n')
    }
    return steps
  } finally {
    release()
    // Anciennes versions supprimées en arrière-plan : le lancement n'attend pas (reprise au suivant sinon).
    void purgeDiscarded(repo).catch(() => undefined)
  }
}

module.exports = {
  prepare,
  plan,
  repoState,
  parsePorcelain,
  acquireLock,
  recover,
  previousBuildUsable,
  rotateLog,
  renameRetry,
  UpdateError,
  STEPS,
  INSTALL_ARGS,
  LOCK,
  STAMP,
}
