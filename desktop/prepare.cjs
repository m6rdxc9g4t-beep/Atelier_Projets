#!/usr/bin/env node
// Prépare l'application de bureau dans le terminal (installation, migrations, compilation si besoin) :
// utilisé par scripts/macos/install-desktop.sh pour que le premier lancement soit immédiat.
'use strict'

const path = require('node:path')
const { prepare } = require('./lib/prepare.cjs')

const repo = path.resolve(__dirname, '..')
const logFile = path.join(require('node:os').tmpdir(), `atelier-projets-prepare-${process.pid}.log`)

prepare(repo, { logFile, onStatus: (text) => console.log(`  → ${text}`) })
  .then((steps) => console.log(steps.includes('build') ? '✔ Application compilée.' : '✔ Application déjà à jour.'))
  .catch((error) => {
    console.error(`✘ ${error.message}\n  Détail : ${logFile}`)
    process.exit(1)
  })
