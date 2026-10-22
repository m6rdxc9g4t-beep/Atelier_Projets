// API Fastify lancée par l'application de bureau : Node du système (celui du dépôt, module natif SQLite compilé
// pour lui), backend compilé (backend/dist), journal dans un fichier.
'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

/** Lit HOST et PORT de backend/.env (sans l'interpréter entièrement) : l'application suit la configuration de l'API. */
function readApiAddress(repo, env = process.env) {
  const values = {}
  try {
    for (const line of fs.readFileSync(path.join(repo, 'backend', '.env'), 'utf8').split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?(HOST|PORT)\s*=\s*["']?([^"'#\s]*)["']?/.exec(line)
      if (match) values[match[1]] = match[2]
    }
  } catch {
    /* pas de .env : valeurs par défaut */
  }
  const port = Number(env.PORT ?? values.PORT ?? 3000)
  const host = env.HOST ?? values.HOST ?? '127.0.0.1'
  // Écoute sur toutes les interfaces : l'API se joint localement par 127.0.0.1.
  const reachable = host === '0.0.0.0' || host === '::' || host === '' ? '127.0.0.1' : host
  return { host: reachable, port: Number.isInteger(port) && port > 0 ? port : 3000 }
}

/** GET avec délai : true si la réponse est 2xx. */
async function isUp(url, timeoutMs = 1500) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return response.ok
  } catch {
    return false
  }
}

/** L'API répond-elle, et est-ce bien celle d'Atelier Projets ? */
async function apiStatus(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return 'other'
    const body = await response.json().catch(() => null)
    return body && typeof body === 'object' && 'status' in body && 'database' in body ? 'atelier' : 'other'
  } catch {
    return 'down'
  }
}

/**
 * Lance `node backend/dist/server.js` et attend /api/health. Renvoie { child, stop() }.
 * Rejette si le processus s'arrête ou ne répond pas dans le délai (le journal donne la cause).
 */
async function startBackend({ repo, node = 'node', env = process.env, logFile, baseUrl, timeoutMs = 60_000 }) {
  const log = fs.openSync(logFile, 'a')
  const child = spawn(node, ['dist/server.js'], {
    cwd: path.join(repo, 'backend'),
    env: { ...env, NODE_ENV: env.NODE_ENV ?? 'production' },
    stdio: ['ignore', log, log],
    windowsHide: true, // Windows : aucune fenêtre de console pour l'API
  })
  fs.closeSync(log)
  let exited = null
  child.once('exit', (code, signal) => (exited = { code, signal }))
  const failed = new Promise((_, reject) => child.once('error', reject))
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (exited) throw new Error(`L’API s’est arrêtée au démarrage (code ${exited.code ?? exited.signal}).`)
    const up = await Promise.race([isUp(`${baseUrl}/api/health`, 1000), failed])
    if (up) return { child, stop: () => stopProcess(child) }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  stopProcess(child)
  throw new Error(`L’API ne répond pas après ${Math.round(timeoutMs / 1000)} s.`)
}

/** SIGTERM (arrêt propre : base fermée ; sous Windows, arrêt immédiat du processus), puis SIGKILL après 5 s. */
function stopProcess(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

module.exports = { readApiAddress, isUp, apiStatus, startBackend, stopProcess }
