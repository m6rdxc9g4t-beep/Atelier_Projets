#!/usr/bin/env node
// Génère src/services/api.gen.ts à partir du contrat OpenAPI du backend (backend/openapi.json).
// openapi-typescript s'appuie sur l'API JavaScript de TypeScript 5 (absente de TypeScript 7) :
// il est donc exécuté à la demande via npx, sans entrer dans les dépendances du projet.
// L'empreinte SHA-256 du contrat est inscrite en tête du fichier : npm run check signale un contrat modifié.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONTRACT = path.join(FRONTEND, '..', 'backend', 'openapi.json')
const OUTPUT = path.join(FRONTEND, 'src', 'services', 'api.gen.ts')

const contract = await readFile(CONTRACT)
const digest = createHash('sha256').update(contract.toString('utf8').replaceAll('\r\n', '\n')).digest('hex')

execFileSync(
  'npx',
  ['--yes', '-p', 'typescript@5.9', '-p', 'openapi-typescript@7.13.0', 'openapi-typescript', CONTRACT, '-o', OUTPUT],
  { stdio: 'inherit', shell: process.platform === 'win32' },
)

const generated = await readFile(OUTPUT, 'utf8')
await writeFile(
  OUTPUT,
  `// Fichier généré par npm run api:types depuis backend/openapi.json — ne pas modifier à la main.\n` +
    `// openapi-sha256: ${digest}\n` +
    generated,
)
console.log(`✔ Types de l'API générés (contrat ${digest.slice(0, 12)})`)
