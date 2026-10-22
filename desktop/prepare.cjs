#!/usr/bin/env node
// Prépare l'application de bureau dans le terminal (dépendances depuis le lockfile, sauvegarde et migrations,
// compilation si besoin) : utilisé par scripts/macos/install-desktop.sh pour que le premier lancement soit immédiat.
// Même mise à jour, même verrou et même journal que l'application (docs/SUITE.md §8).
'use strict'

const os = require('node:os')
const path = require('node:path')
const { prepare } = require('./lib/prepare.cjs')

const repo = path.resolve(__dirname, '..')
const logDir =
  process.env.ATELIER_LOG_DIR || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Logs', 'Atelier_Projets') : os.tmpdir())
const logFile = path.join(logDir, process.platform === 'darwin' || process.env.ATELIER_LOG_DIR ? 'mise-a-jour.log' : `atelier-projets-mise-a-jour-${process.pid}.log`)

prepare(repo, { logFile, onStatus: (text) => console.log(`  → ${text}`) })
  .then((steps) => console.log(steps.includes('build') ? '✔ Application compilée.' : '✔ Application déjà à jour.'))
  .catch((error) => {
    console.error(`✘ ${error.message}`)
    if (error.hint) console.error(`  ${error.hint}`)
    if (error.canUsePrevious) console.error('  La version compilée précédente est intacte.')
    console.error(`  Détail : ${logFile}`)
    process.exit(1)
  })
