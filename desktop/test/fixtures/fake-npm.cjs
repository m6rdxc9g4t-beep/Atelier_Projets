#!/usr/bin/env node
// npm simulé pour test/prepare.test.cjs : note chaque appel (FAKE_NPM_CALLS, une ligne JSON) avec l'état du dépôt
// au moment de l'appel, produit les fichiers attendus et échoue à l'étape FAKE_NPM_FAIL (ci, db:deploy, build-frontend…).
// Lancé par « node fake-npm.cjs … » (sans shell, comme npm-cli.js sous Windows). db:deploy refuse, comme
// backend/src/config.ts (loadConfig), un DATABASE_URL qui n'est pas une URL SQLite « file: ».
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
const repo = process.cwd()
const fail = process.env.FAKE_NPM_FAIL || ''
const read = (file) => {
  try {
    return fs.readFileSync(path.join(repo, file), 'utf8')
  } catch {
    return null
  }
}
const write = (file, content) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  fs.writeFileSync(path.join(repo, file), content)
}

const call = { args, inherited: Object.fromEntries(['DATABASE_URL', 'PORT', 'HOST', 'NODE_ENV'].map((name) => [name, process.env[name] ?? null])) }
const workspace = (args.find((arg) => arg.startsWith('--workspace=')) ?? '').replace('--workspace=@atelier/', '')
if (args[0] === 'ci') call.modulesBefore = { root: fs.existsSync(path.join(repo, 'node_modules')), backend: fs.existsSync(path.join(repo, 'backend', 'node_modules')) }
if (args[1] === 'build') call.distBefore = read(`${workspace}/dist/${workspace === 'backend' ? 'server.js' : 'index.html'}`)
fs.appendFileSync(process.env.FAKE_NPM_CALLS, `${JSON.stringify(call)}\n`)
console.log(`npm simulé : ${args.join(' ')}`)

if (args[0] === 'ci') {
  write('node_modules/partiel', 'téléchargement interrompu')
  if (fail === 'ci') {
    console.error('npm error network ECONNRESET')
    process.exit(1)
  }
  fs.rmSync(path.join(repo, 'node_modules', 'partiel'))
  write('node_modules/.package-lock.json', 'nouveau')
  write('backend/node_modules/module-local/index.js', 'nouveau')
  process.exit(0)
}
if (args[1] === 'db:generate') write('backend/src/generated/index.ts', '// généré')
const databaseUrl = process.env.DATABASE_URL?.trim()
if (args[1] === 'db:deploy' && databaseUrl && !databaseUrl.startsWith('file:')) {
  console.error(`✘ Sauvegarde de la base impossible avant les migrations : DATABASE_URL doit être une URL SQLite « file:… » (reçu : ${databaseUrl})`)
  process.exit(1)
}
if (args[1] === 'db:deploy' && fail === 'db:deploy') {
  console.error('Error: P3018 A migration failed to apply.')
  process.exit(1)
}
if (args[1] === 'build') {
  const outDir = args[args.indexOf('--outDir') + 1]
  write(`${workspace}/${outDir}/${workspace === 'backend' ? 'server.js' : 'index.html'}`, workspace === 'frontend' && fail === 'build-frontend' ? 'partiel' : 'nouveau')
  if (fail === `build-${workspace}`) {
    console.error('error TS2304: Cannot find name')
    process.exit(2)
  }
}
