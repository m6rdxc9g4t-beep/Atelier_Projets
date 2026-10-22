// Environnement de l'app de bureau (docs/SUITE.md §9.4) et emplacements par système (§9.2). Logique pure, sans Electron.
'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { IGNORED_INHERITED, desktopEnvironment, ignoredMessage, minimalEnvironment, sanitizeProcessEnv } = require('../lib/environment.cjs')
const { dataDirectory, logDirectory } = require('../lib/paths.cjs')

const NEXUS_URL = 'sqlite+aiosqlite:////Users/camille/Library/Application Support/Atelier Nexus/nexus.db'

describe('variables héritées ignorées au lancement de l’app de bureau', () => {
  it('retire DATABASE_URL (cas réel : ouverte depuis Atelier Nexus) et les réglages d’une autre app, garde le reste', () => {
    const { env, ignored } = desktopEnvironment(
      {
        DATABASE_URL: NEXUS_URL,
        PORT: '8100',
        HOST: '0.0.0.0',
        ALLOWED_HOSTS: 'nexus.local',
        ATELIER_IMPORT_TOKEN: 'secret',
        LOG_LEVEL: 'WARNING',
        NODE_ENV: 'development',
        BACKUP_DIR: '/ailleurs',
        BACKUP_KEEP: '0',
        PATH: '/usr/bin',
        HOME: '/Users/camille',
        OLLAMA_URL: 'http://localhost:11434',
        CLAUDE_CLI: '/opt/claude',
        ATELIER_REPO: '/Users/camille/Atelier_Projets',
      },
      { platform: 'darwin' },
    )
    assert.deepEqual(ignored.sort(), Object.keys(IGNORED_INHERITED).sort())
    assert.deepEqual(env, {
      PATH: '/usr/bin',
      HOME: '/Users/camille',
      OLLAMA_URL: 'http://localhost:11434',
      CLAUDE_CLI: '/opt/claude',
      ATELIER_REPO: '/Users/camille/Atelier_Projets',
    })
  })

  it('Windows : noms insensibles à la casse', () => {
    const { env, ignored } = desktopEnvironment({ database_url: NEXUS_URL, Port: '8100', Path: 'C:\\Windows' }, { platform: 'win32' })
    assert.deepEqual(ignored, ['database_url', 'Port'])
    assert.deepEqual(env, { Path: 'C:\\Windows' })
    // Ailleurs, la casse compte (une variable « database_url » n'est pas lue par le backend).
    assert.deepEqual(desktopEnvironment({ database_url: 'x' }, { platform: 'linux' }).ignored, [])
  })

  it('appliqué à process.env en place ; message de journal sans aucune valeur', () => {
    const target = { DATABASE_URL: NEXUS_URL, PORT: '8100', KEEP: 'oui' }
    const ignored = sanitizeProcessEnv(target, { platform: 'darwin' })
    assert.deepEqual(target, { KEEP: 'oui' })
    const message = ignoredMessage(ignored)
    assert.equal(message, 'Variables héritées ignorées (configuration de backend/.env ou valeurs par défaut) : DATABASE_URL, PORT.')
    assert.equal(message.includes('nexus'), false)
    assert.equal(ignoredMessage([]), null)
  })
})

describe('environnement minimal pour ouvrir une autre app de la suite', () => {
  const parent = {
    HOME: '/Users/camille',
    USER: 'camille',
    LOGNAME: 'camille',
    LANG: 'fr_FR.UTF-8',
    LC_ALL: 'fr_FR.UTF-8',
    TZ: 'Europe/Paris',
    TMPDIR: '/var/folders/x',
    PATH: '/Users/camille/.nvm/bin:/usr/bin',
    DATABASE_URL: 'file:./prisma/dev.db',
    PORT: '3000',
    ATELIER_REPO: '/depot',
    ELECTRON_RUN_AS_NODE: '1',
    NODE_OPTIONS: '--inspect',
    PYTHONPATH: '/x',
    NEXUS_DATA_DIR: '/y',
    GITHUB_TOKEN: 'ghp_secret',
    LC_lower: 'ignoré',
  }

  it('macOS : liste blanche + PATH système, aucune variable de l’app', () => {
    assert.deepEqual(minimalEnvironment(parent, { platform: 'darwin' }), {
      HOME: '/Users/camille',
      USER: 'camille',
      LOGNAME: 'camille',
      LANG: 'fr_FR.UTF-8',
      LC_ALL: 'fr_FR.UTF-8',
      TZ: 'Europe/Paris',
      TMPDIR: '/var/folders/x',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    })
  })

  it('Windows : profil, dossiers système, PATH de la session (registre) s’il est connu', () => {
    const windows = {
      USERPROFILE: 'C:\\Users\\François',
      USERNAME: 'François',
      APPDATA: 'C:\\Users\\François\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\François\\AppData\\Local',
      TEMP: 'C:\\Users\\François\\AppData\\Local\\Temp',
      TMP: 'C:\\Users\\François\\AppData\\Local\\Temp',
      SystemRoot: 'C:\\WINDOWS',
      windir: 'C:\\WINDOWS',
      ComSpec: 'C:\\WINDOWS\\system32\\cmd.exe',
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      Path: 'C:\\depot\\node_modules\\.bin;C:\\WINDOWS\\system32',
      DATABASE_URL: 'file:x',
      ATELIER_UI_PORT: '4174',
    }
    const env = minimalEnvironment(windows, { platform: 'win32', pathValue: 'C:\\WINDOWS\\system32;C:\\Program Files\\nodejs' })
    assert.equal(env.Path, 'C:\\WINDOWS\\system32;C:\\Program Files\\nodejs')
    assert.equal(env.DATABASE_URL, undefined)
    assert.equal(env.ATELIER_UI_PORT, undefined)
    assert.equal(env.USERPROFILE, 'C:\\Users\\François')
    assert.equal(env['ProgramFiles(x86)'], 'C:\\Program Files (x86)')
    assert.equal(Object.keys(env).length, Object.keys(windows).length - 2)
    // PATH de la session illisible : dossiers de Windows seulement.
    assert.match(minimalEnvironment(windows, { platform: 'win32' }).Path, /^C:\\WINDOWS\\System32;C:\\WINDOWS;C:\\WINDOWS\\System32\\Wbem;/)
  })
})

describe('emplacements par système (§9.2)', () => {
  it('journaux : macOS inchangé, Windows %LOCALAPPDATA%\\Atelier_Projets\\Logs, ATELIER_LOG_DIR prioritaire', () => {
    assert.equal(logDirectory({ platform: 'darwin', env: {}, home: '/Users/camille' }), '/Users/camille/Library/Logs/Atelier_Projets')
    assert.equal(
      logDirectory({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\François\\AppData\\Local' }, home: 'C:\\Users\\François' }),
      'C:\\Users\\François\\AppData\\Local\\Atelier_Projets\\Logs',
    )
    assert.equal(logDirectory({ platform: 'win32', env: {}, home: 'C:\\Users\\Zoé' }), 'C:\\Users\\Zoé\\AppData\\Local\\Atelier_Projets\\Logs')
    assert.equal(logDirectory({ platform: 'linux', env: {}, home: '/home/c' }), null)
    assert.equal(logDirectory({ platform: 'darwin', env: { ATELIER_LOG_DIR: '/tmp/journaux' }, home: '/Users/c' }), '/tmp/journaux')
  })

  it('données hors dépôt : Windows %APPDATA%\\Atelier_Projets, ailleurs dossier par défaut d’Electron', () => {
    assert.equal(dataDirectory({ platform: 'win32', env: { APPDATA: 'D:\\Profils\\François\\AppData\\Roaming' } }), 'D:\\Profils\\François\\AppData\\Roaming\\Atelier_Projets')
    assert.equal(dataDirectory({ platform: 'darwin', env: {} }), null)
  })
})
