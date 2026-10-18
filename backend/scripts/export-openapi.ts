// Exporte le contrat OpenAPI de l'API dans backend/openapi.json, sans démarrer le serveur ni ouvrir la base.
// Le frontend en génère ses types (npm run api:types -w @atelier/frontend) : contrat unique, aucune dérive.
// Usage : npm run openapi -w @atelier/backend   ·   --check : échoue si le fichier n'est pas à jour.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from '../src/app.ts'
import { BACKEND_ROOT } from '../src/config.ts'
import { createPrismaClient } from '../src/db/client.ts'

export const OPENAPI_FILE = path.join(BACKEND_ROOT, 'openapi.json')

/** Contrat OpenAPI sérialisé de façon stable (indépendant de l'URL publique et de la machine). */
export async function renderOpenApi(): Promise<string> {
  const app = await buildApp({ prisma: createPrismaClient('file::memory:'), logger: false, timeZone: 'UTC' })
  try {
    await app.ready()
    return `${JSON.stringify(app.swagger(), null, 2)}\n`
  } finally {
    await app.close()
  }
}

// Exécution directe uniquement (le test d'actualité importe renderOpenApi sans écrire le fichier).
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const content = await renderOpenApi()
  if (process.argv.includes('--check')) {
    const current = await readFile(OPENAPI_FILE, 'utf8').catch(() => '')
    if (current !== content) {
      console.error('✘ backend/openapi.json n’est pas à jour : lancer npm run openapi -w @atelier/backend')
      process.exit(1)
    }
    console.log('✔ backend/openapi.json à jour')
  } else {
    await writeFile(OPENAPI_FILE, content)
    console.log(`✔ Contrat OpenAPI écrit dans ${path.relative(process.cwd(), OPENAPI_FILE) || OPENAPI_FILE}`)
  }
}
