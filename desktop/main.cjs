// Atelier Projets — application de bureau (Electron).
// Une fenêtre native : au lancement, se met à jour si le dépôt a changé (docs/SUITE.md §8 : dépendances depuis
// le lockfile, sauvegarde puis migrations de la base, compilation ; lib/prepare.cjs), démarre l'API (backend
// compilé, Node du système) et sert l'interface compilée sur l'adresse « app » de la Suite Atelier
// (http://127.0.0.1:4174) ; Cmd+Q arrête tout. Si l'application tourne déjà dans un terminal
// (npm run app / npm run dev), la fenêtre l'utilise sans rien relancer.
//
// Lancée par « Atelier Projets.app » (scripts/macos/install-desktop.sh), qui fixe ATELIER_REPO et le PATH,
// ou directement : npm start --workspace=@atelier/desktop
'use strict'

const { app, BrowserWindow, Menu, dialog, nativeTheme, screen, shell } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { apiStatus, isUp, readApiAddress, startBackend } = require('./lib/backend.cjs')
const { ignoredMessage, sanitizeProcessEnv } = require('./lib/environment.cjs')
const { findNode } = require('./lib/node-path.cjs')
const { prepare, UpdateError } = require('./lib/prepare.cjs')
const { openSuiteOrExternal } = require('./lib/suite-launch.cjs')
const { startUiServer } = require('./lib/ui-server.cjs')

// Variables héritées d'une autre app (ouverte depuis Atelier Nexus : DATABASE_URL de nexus.db, PORT…) : ignorées
// avant tout, la configuration vient de backend/.env ou des valeurs par défaut (docs/SUITE.md §9.4, lib/environment.cjs).
const IGNORED_ENV = sanitizeProcessEnv()

const REPO = path.resolve(process.env.ATELIER_REPO || path.join(__dirname, '..'))
const UI_PORT = Number(process.env.ATELIER_UI_PORT || 4174)
const UI_URL = `http://127.0.0.1:${UI_PORT}`
const PRODUCT = 'Atelier Projets'

app.setName(PRODUCT)
const LOG_DIR =
  process.env.ATELIER_LOG_DIR ||
  (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Logs', 'Atelier_Projets') : path.join(app.getPath('userData'), 'logs'))
const LOG_FILE = path.join(LOG_DIR, 'app.log')
/** Journal des mises à jour (npm ci, sauvegarde et migrations, compilation) : docs/SUITE.md §8.2. */
const UPDATE_LOG = path.join(LOG_DIR, 'mise-a-jour.log')
fs.mkdirSync(LOG_DIR, { recursive: true })

/** Chemin lisible (~ pour le dossier personnel), pour les messages. */
function displayPath(file) {
  const home = os.homedir()
  return file.startsWith(`${home}${path.sep}`) ? `~${file.slice(home.length)}` : file
}

function log(message) {
  fs.appendFileSync(LOG_FILE, `[${new Date().toLocaleString('fr-FR')}] ${message}\n`)
}

/** Ce que l'application a lancé elle-même (et doit donc arrêter en quittant). */
const owned = { backend: null, ui: null }
let mainWindow = null
let quitting = false

// --- Fenêtre ------------------------------------------------------------------------------------------

const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json')

function loadBounds() {
  try {
    const bounds = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    // Fenêtre encore visible sur un des écrans (écran externe débranché depuis).
    const visible = screen.getAllDisplays().some(({ workArea: area }) =>
      bounds.x < area.x + area.width && bounds.x + bounds.width > area.x && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y,
    )
    return visible ? bounds : { width: bounds.width, height: bounds.height }
  } catch {
    return { width: 1480, height: 940 }
  }
}

function saveBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isFullScreen()) return
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() }))
  } catch {
    /* préférence non mémorisée */
  }
}

function createWindow() {
  const bounds = loadBounds()
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 620,
    title: PRODUCT,
    show: false,
    // Proche de --atelier-bg (charte néon monochrome, vert citron) : sombre ≈ signature 6 % dans #07070A, clair ≈ 5 % dans #FBFBFD.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0D100E' : '#F6FAF4',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  })
  if (bounds.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => mainWindow.show())
  for (const event of ['resize', 'move']) mainWindow.on(event, saveBounds)
  mainWindow.on('close', saveBounds)
  mainWindow.on('closed', () => (mainWindow = null))

  const contents = mainWindow.webContents
  // Liens externes : autres apps de la Suite Atelier → l'application installée (docs/SUITE.md §3) ;
  // le reste (GitHub, documentation) → navigateur par défaut.
  const openOutside = (url) => {
    if (!/^https?:\/\//.test(url)) return
    void openSuiteOrExternal(url, { execFile, openExternal: (target) => shell.openExternal(target) }).catch((error) =>
      log(`Ouverture impossible (${url}) : ${error.message}`),
    )
  }
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${UI_URL}/`) && !url.startsWith(`${UI_URL}/api/`)) return { action: 'allow' }
    openOutside(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (url.startsWith(`${UI_URL}/`) || url === UI_URL || url.startsWith('file://')) return
    event.preventDefault()
    openOutside(url)
  })
  // Interface rechargée par erreur pendant que l'API redémarre : simple rechargement.
  contents.on('did-fail-load', (_event, code, description, url) => {
    if (url.startsWith(UI_URL) && code !== -3) log(`Chargement échoué (${code} ${description}) : ${url}`)
  })
  return mainWindow
}

function setStatus(text, hint = '') {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const contents = mainWindow.webContents
  if (!contents.getURL().startsWith('file://')) return
  contents.executeJavaScript(`window.setStatus && window.setStatus(${JSON.stringify(text)}, ${JSON.stringify(hint)})`).catch(() => undefined)
}

// --- Menu ---------------------------------------------------------------------------------------------

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac
      ? [
          {
            label: PRODUCT,
            submenu: [
              { role: 'about', label: `À propos d’${PRODUCT}` },
              { type: 'separator' },
              { role: 'hide', label: `Masquer ${PRODUCT}` },
              { role: 'hideOthers', label: 'Masquer les autres' },
              { role: 'unhide', label: 'Tout afficher' },
              { type: 'separator' },
              { role: 'quit', label: `Quitter ${PRODUCT}` },
            ],
          },
        ]
      : []),
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'pasteAndMatchStyle', label: 'Coller sans mise en forme' },
        { role: 'selectAll', label: 'Tout sélectionner' },
      ],
    },
    {
      label: 'Présentation',
      submenu: [
        { role: 'reload', label: 'Actualiser' },
        { role: 'forceReload', label: 'Forcer l’actualisation' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Taille réelle' },
        { role: 'zoomIn', label: 'Agrandir' },
        { role: 'zoomOut', label: 'Réduire' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        { role: 'toggleDevTools', label: 'Outils de développement' },
      ],
    },
    { role: 'windowMenu', label: 'Fenêtre' },
    {
      role: 'help',
      label: 'Aide',
      submenu: [
        { label: 'Journal de l’application', click: () => void shell.openPath(LOG_FILE) },
        { label: 'Journal des mises à jour', click: () => void shell.openPath(UPDATE_LOG) },
        { label: 'Documentation de l’API', click: () => void shell.openExternal(`${UI_URL}/api/docs`) },
        { label: 'Ouvrir dans le navigateur', click: () => void shell.openExternal(UI_URL) },
        { label: 'Afficher le dépôt dans le Finder', click: () => void shell.openPath(REPO) },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// --- Démarrage ----------------------------------------------------------------------------------------

/** L'adresse sert-elle déjà l'interface d'Atelier Projets (npm run app, autre instance) ? */
async function uiAlreadyServed() {
  try {
    const response = await fetch(`${UI_URL}/`, { signal: AbortSignal.timeout(1500) })
    const html = await response.text()
    return response.ok && /Atelier/.test(html) && (await isUp(`${UI_URL}/api/health`))
  } catch {
    return false
  }
}

async function start() {
  log(`===== Démarrage (dépôt ${REPO}) =====`)
  if (IGNORED_ENV.length > 0) log(ignoredMessage(IGNORED_ENV))
  if (!fs.existsSync(path.join(REPO, 'backend', 'package.json'))) {
    throw new Error(`Dépôt introuvable : ${REPO}\nRelancer « npm run app:install » depuis le dépôt.`)
  }

  if (await uiAlreadyServed()) {
    log(`Interface déjà servie sur ${UI_URL} : utilisée telle quelle.`)
    return
  }

  const api = readApiAddress(REPO)
  const apiUrl = `http://${api.host}:${api.port}`
  const status = await apiStatus(apiUrl)
  if (status === 'other') throw new Error(`Le port ${api.port} est occupé par une autre application que l’API d’Atelier Projets.`)

  // Après un « git pull » : dépendances, sauvegarde et migrations, compilation remises à jour (rien à faire sinon).
  await useSystemNode()
  await update()

  if (status === 'down') {
    setStatus('Démarrage de l’API…')
    owned.backend = await startBackend({ repo: REPO, logFile: LOG_FILE, baseUrl: apiUrl })
    log(`API démarrée sur ${apiUrl} (pid ${owned.backend.child.pid}).`)
    owned.backend.child.once('exit', (code, signal) => {
      if (quitting) return
      log(`L’API s’est arrêtée (code ${code ?? signal}).`)
      void showFatal(new Error('L’API locale s’est arrêtée de façon inattendue.'))
    })
  } else {
    log(`API déjà en marche sur ${apiUrl} (npm run dev ?) : utilisée telle quelle.`)
  }

  setStatus('Ouverture de l’interface…')
  try {
    owned.ui = await startUiServer({ root: path.join(REPO, 'frontend', 'dist'), port: UI_PORT, apiPort: api.port })
  } catch (error) {
    if (error && error.code === 'EADDRINUSE') {
      throw new Error(`Le port ${UI_PORT} est déjà utilisé (npm run preview ou une autre application ?).`)
    }
    throw error
  }
  log(`Interface servie sur ${UI_URL}.`)
}

/** Choix « Quitter » après un échec de mise à jour : le démarrage s'arrête sans autre message. */
const QUIT = Symbol('quit')

/**
 * Node et npm du système : une application ouverte depuis le Finder n'a pas le PATH du terminal (lib/node-path.cjs).
 * Cherchés une fois par lancement de l'application.
 */
let nodeFound = null
async function useSystemNode() {
  if (nodeFound) return
  setStatus('Recherche de Node.js…')
  const found = await findNode()
  if (!found) {
    throw new Error(
      'Node.js et npm introuvables (PATH du terminal zsh, ~/.homebrew/bin, /opt/homebrew/bin, /usr/local/bin, nvm).\nInstaller Node.js 24, puis relancer l’application.',
    )
  }
  process.env.PATH = found.path
  nodeFound = found
  log(`Node ${found.version} : ${found.dir}${found.supported ? '' : ' — version non prise en charge par le dépôt (Node 22.12+ ou 24+ attendu)'}`)
}

/** Mise à jour depuis le dépôt ; en cas d'échec, l'écran de démarrage propose la version précédente, un nouvel essai ou de quitter. */
async function update() {
  for (;;) {
    try {
      const steps = await prepare(REPO, {
        logFile: UPDATE_LOG,
        onStatus: (text) => setStatus(text, 'Première ouverture ou mise à jour : cela peut prendre une minute.'),
      })
      if (steps.length > 1) log(`Mise à jour faite (${steps.join(', ')}) : détail dans ${UPDATE_LOG}`)
      return
    } catch (error) {
      if (!(error instanceof UpdateError)) throw error
      log(`Mise à jour échouée : ${error.message} (détail : ${UPDATE_LOG})`)
      const choice = await askAfterFailure(error)
      if (choice === 'previous') {
        log('Ouverture avec la version précédente ; la mise à jour sera retentée au prochain lancement.')
        return
      }
      if (choice === 'quit') {
        app.quit()
        throw QUIT
      }
    }
  }
}

/** Affiche l'échec dans l'écran de démarrage et attend le choix (bouton → ancre #choix=… de la page). */
function askAfterFailure(error) {
  const contents = mainWindow?.webContents
  if (!contents || contents.isDestroyed()) return Promise.resolve('quit')
  const failure = { message: error.message, hint: error.hint, logFile: displayPath(error.logFile), canUsePrevious: error.canUsePrevious }
  return new Promise((resolve) => {
    const onNavigate = (_event, url) => {
      const match = /#choix=(previous|retry|log|quit)-\d+$/.exec(url)
      if (!match || (match[1] === 'previous' && !error.canUsePrevious)) return
      if (match[1] === 'log') return void shell.openPath(error.logFile)
      contents.off('did-navigate-in-page', onNavigate)
      resolve(match[1])
    }
    contents.on('did-navigate-in-page', onNavigate)
    contents.executeJavaScript(`window.showFailure(${JSON.stringify(failure)})`).catch(() => {
      contents.off('did-navigate-in-page', onNavigate)
      resolve('quit')
    })
  })
}

async function showFatal(error) {
  const message = error instanceof Error ? error.message : String(error)
  log(`ERREUR : ${message}`)
  const { response } = await dialog.showMessageBox(mainWindow ?? undefined, {
    type: 'error',
    title: PRODUCT,
    message: 'Atelier Projets n’a pas pu démarrer',
    detail: `${message}\n\nLe journal donne le détail : ${LOG_FILE}`,
    buttons: ['Ouvrir le journal', 'Réessayer', 'Quitter'],
    defaultId: 1,
    cancelId: 2,
  })
  if (response === 0) {
    await shell.openPath(LOG_FILE)
    return showFatal(error)
  }
  if (response === 1) {
    await shutdown()
    quitting = false
    return launch()
  }
  app.quit()
}

async function launch() {
  if (!mainWindow) createWindow()
  await mainWindow.loadFile(path.join(__dirname, 'splash.html'))
  try {
    await start()
    await mainWindow.loadURL(`${UI_URL}/`)
  } catch (error) {
    if (error !== QUIT) await showFatal(error)
  }
}

async function shutdown() {
  quitting = true
  const { backend, ui } = owned
  owned.backend = null
  owned.ui = null
  if (ui) await new Promise((resolve) => ui.server.close(() => resolve()))
  if (backend) {
    log('Arrêt de l’API.')
    await backend.stop()
  }
}

// --- Cycle de vie -------------------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    buildMenu()
    void launch()
  })

  // Fermer la fenêtre quitte l'application (et arrête l'API qu'elle a lancée).
  app.on('window-all-closed', () => app.quit())

  let stopped = false
  app.on('before-quit', (event) => {
    if (stopped) return
    event.preventDefault()
    void shutdown().finally(() => {
      stopped = true
      app.quit()
    })
  })
}
