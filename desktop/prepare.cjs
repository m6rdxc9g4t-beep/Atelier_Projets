#!/usr/bin/env node
// Prépare l'application de bureau dans le terminal (dépendances depuis le lockfile, sauvegarde et migrations,
// compilation si besoin) : utilisé par scripts/macos/install-desktop.sh et scripts/windows/install.ps1 pour que le
// premier lancement soit immédiat. Même mise à jour, même verrou et même journal que l'application (docs/SUITE.md §8) ;
// comme elle, ignore les variables héritées d'une autre app (DATABASE_URL…, lib/environment.cjs).
// Code de sortie : 0 réussite (« à jour » ou « compilée »), 1 échec de la mise à jour.
'use strict'

const os = require('node:os')
const path = require('node:path')
const { desktopEnvironment, ignoredMessage } = require('./lib/environment.cjs')
const { logDirectory } = require('./lib/paths.cjs')
const { prepare } = require('./lib/prepare.cjs')

const repo = path.resolve(__dirname, '..')
const logDir = logDirectory()
const logFile = logDir ? path.join(logDir, 'mise-a-jour.log') : path.join(os.tmpdir(), `atelier-projets-mise-a-jour-${process.pid}.log`)

const { ignored } = desktopEnvironment(process.env)
if (ignored.length > 0) console.log(`  ${ignoredMessage(ignored)}`)

prepare(repo, { logFile, onStatus: (text) => console.log(`  → ${text}`) })
  .then((steps) => console.log(steps.includes('build') ? '✔ Application compilée.' : '✔ Application déjà à jour.'))
  .catch((error) => {
    console.error(`✘ ${error.message}`)
    if (error.hint) console.error(`  ${error.hint}`)
    if (error.canUsePrevious) console.error('  La version compilée précédente est intacte.')
    console.error(`  Détail : ${logFile}`)
    process.exit(1)
  })
