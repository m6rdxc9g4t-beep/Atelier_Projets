#!/usr/bin/env node
// Contrôles du frontend (CLAUDE.md §1) :
//  - aucune couleur en dur (#hex, rgb(), hsl()…) dans src/ et index.html : tout passe par le design system ;
//  - les types de l'API (src/services/api.gen.ts) correspondent au contrat actuel du backend (backend/openapi.json).
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const errors = []

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

const COLOR_LITERAL = /#[0-9a-f]{3,8}\b(?![-\w])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi
const files = [path.join(FRONTEND, 'index.html')]
for await (const file of walk(path.join(FRONTEND, 'src'))) {
  if (/\.(tsx?|css|html)$/.test(file) && !file.endsWith('api.gen.ts')) files.push(file)
}
for (const file of files) {
  const lines = (await readFile(file, 'utf8')).split('\n')
  lines.forEach((line, index) => {
    for (const [literal] of line.matchAll(COLOR_LITERAL)) {
      errors.push(`${path.relative(FRONTEND, file)}:${index + 1} : couleur en dur « ${literal} » (utiliser une variable du design system)`)
    }
  })
}

const contract = await readFile(path.join(FRONTEND, '..', 'backend', 'openapi.json'))
const digest = createHash('sha256').update(contract.toString('utf8').replaceAll('\r\n', '\n')).digest('hex')
const generated = await readFile(path.join(FRONTEND, 'src', 'services', 'api.gen.ts'), 'utf8')
if (!generated.includes(`// openapi-sha256: ${digest}`)) {
  errors.push('src/services/api.gen.ts ne correspond plus à backend/openapi.json : lancer npm run api:types -w @atelier/frontend')
}

if (errors.length > 0) {
  console.error(`✘ Frontend NON conforme (${errors.length}) :`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}
console.log(`✔ Frontend conforme : ${files.length} fichiers sans couleur en dur, types de l'API à jour.`)
