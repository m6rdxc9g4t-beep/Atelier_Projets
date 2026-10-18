// Configuration du backend : chargement facultatif de backend/.env et lecture typée des variables.
// Module partagé par le serveur, le seed et prisma.config.ts (une seule règle pour l'URL SQLite).
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Racine du workspace backend — identique depuis src/ (tsx) et depuis dist/ (build). */
export const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Base SQLite par défaut, relative à BACKEND_ROOT. */
export const DEFAULT_DATABASE_URL = 'file:./prisma/dev.db'

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export interface AppConfig {
  host: string
  port: number
  logLevel: LogLevel
  databaseUrl: string
  /** Fuseau IANA des horodatages lisibles (journal d'avancement, date du jour). */
  timeZone: string
  /** URL de l'API pour les outils locaux (hook post-commit). */
  publicUrl: string
  /** Jeton GitHub facultatif (dépôts privés, quota d'API plus large). Jamais journalisé. */
  githubToken: string | undefined
  /** API GitHub (GitHub Enterprise : https://<hôte>/api/v3). */
  githubApiUrl: string | undefined
  /** Commits lus au plus par branche lors d'une analyse. */
  gitScanMaxCommits: number
}

/**
 * Charge backend/.env s'il existe (Prisma 7 ne le fait plus automatiquement).
 * Les variables déjà présentes dans l'environnement restent prioritaires.
 */
export function loadEnvFile(file: string = path.join(BACKEND_ROOT, '.env')): void {
  if (existsSync(file)) process.loadEnvFile(file)
}

/**
 * Normalise une URL SQLite « file: ». Un chemin relatif est résolu depuis BACKEND_ROOT,
 * quel que soit le dossier courant (CLI Prisma, serveur, seed ou build).
 */
export function resolveDatabaseUrl(raw: string | undefined = process.env.DATABASE_URL): string {
  const url = raw?.trim() || DEFAULT_DATABASE_URL
  if (!url.startsWith('file:')) {
    throw new Error(`DATABASE_URL doit être une URL SQLite « file:… » (reçu : ${url})`)
  }
  const location = url.slice('file:'.length)
  const queryStart = location.indexOf('?')
  const filePath = queryStart === -1 ? location : location.slice(0, queryStart)
  const query = queryStart === -1 ? '' : location.slice(queryStart)
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(BACKEND_ROOT, filePath)
  return `file:${absolutePath}${query}`
}

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value)
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 3000
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT invalide : « ${value} » (entier entre 1 et 65535 attendu)`)
  }
  return port
}

function parseLogLevel(value: string | undefined): LogLevel {
  const level = (value?.trim() || 'info').toLowerCase()
  if (!isLogLevel(level)) {
    throw new Error(`LOG_LEVEL invalide : « ${value} » (attendu : ${LOG_LEVELS.join(' | ')})`)
  }
  return level
}

/** Fuseau par défaut : celui du système (Europe/Paris sur un poste français). */
export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function parseTimeZone(value: string | undefined): string {
  const timeZone = value?.trim() || systemTimeZone()
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone })
  } catch {
    throw new Error(`APP_TIMEZONE invalide : « ${value} » (fuseau IANA attendu, ex. Europe/Paris)`)
  }
  return timeZone
}

function parsePositiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
    throw new Error(`${name} invalide : « ${value} » (entier entre 1 et 1000000 attendu)`)
  }
  return parsed
}

/** URL locale de l'API : une écoute sur toutes les interfaces se joint par 127.0.0.1. */
export function localApiUrl(host: string, port: number): string {
  const reachable = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host
  return `http://${reachable}:${port}`
}

/** Lit la configuration depuis l'environnement (après loadEnvFile()). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.HOST?.trim() || '127.0.0.1'
  const port = parsePort(env.PORT)
  return {
    host,
    port,
    logLevel: parseLogLevel(env.LOG_LEVEL),
    databaseUrl: resolveDatabaseUrl(env.DATABASE_URL),
    timeZone: parseTimeZone(env.APP_TIMEZONE),
    publicUrl: localApiUrl(host, port),
    githubToken: env.GITHUB_TOKEN?.trim() || undefined,
    githubApiUrl: env.GITHUB_API_URL?.trim() || undefined,
    gitScanMaxCommits: parsePositiveInteger('GIT_SCAN_MAX_COMMITS', env.GIT_SCAN_MAX_COMMITS, 5000),
  }
}
