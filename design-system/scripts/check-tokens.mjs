#!/usr/bin/env node
// Atelier_Projets · Design System — contrôle de conformité avec la spécification
// (CLAUDE.md §2, README.md §2). Sans dépendance : node scripts/check-tokens.mjs
//
// Vérifie que :
//  - tokens/colors.css déclare exactement les 7 types et les 8 statuts, avec les codes hex officiels ;
//  - themes/light.css et themes/dark.css déclarent exactement les 6 variables de fondation ;
//  - les thèmes restent du CSS natif pur, sans dépendance métier (ni @import, ni url(), ni var(),
//    ni variable --type-* / --status-*), donc copiables tels quels dans une autre application ;
//  - les jetons dérivés (tokens/ui.css) et les composants (components/*.css) n'introduisent aucune couleur
//    littérale (#hex, rgb(), hsl()…) et ne redéfinissent ni les tokens officiels ni les variables de thème.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const TYPES = {
  '--type-phase': '#FF8F2B',
  '--type-milestone': '#2A9A30',
  '--type-epic': '#8250DF',
  '--type-story': '#6F42C1',
  '--type-feature': '#2A9A30',
  '--type-task': '#1B66A3',
  '--type-bug': '#D64545',
}

const STATUSES = {
  '--status-open': '#64748B',
  '--status-progress': '#2563EB',
  '--status-review': '#8B5CF6',
  '--status-hold': '#F59E0B',
  '--status-blocked': '#EA580C',
  '--status-resolved': '#0D9488',
  '--status-closed': '#16A34A',
  '--status-rejected': '#DC2626',
}

const THEMES = {
  'themes/light.css': {
    '--bg-main': '#F8FAFC',
    '--bg-surface': '#FFFFFF',
    '--bg-elevated': '#F1F5F9',
    '--text-primary': '#0F172A',
    '--text-muted': '#64748B',
    '--border-color': '#E2E8F0',
  },
  // Thème sombre « néon holographique » (docs/SUITE.md §1.7) : bleu nuit des logos, bordures teintées de cyan.
  'themes/dark.css': {
    '--bg-main': '#06111F',
    '--bg-surface': '#0A1B2E',
    '--bg-elevated': '#10283F',
    '--text-primary': '#E6F7FF',
    '--text-muted': '#8DB4CC',
    '--border-color': '#17405C',
  },
}

const errors = []

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Extrait les déclarations de custom properties d'un fichier CSS (hors commentaires). */
function readCustomProperties(file, css) {
  const declarations = new Map()
  for (const [, name, value] of stripComments(css).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (declarations.has(name)) errors.push(`${file} : ${name} est déclarée plusieurs fois`)
    declarations.set(name, value.trim())
  }
  return declarations
}

function expectExactly(file, declarations, expected) {
  for (const [name, hex] of Object.entries(expected)) {
    const actual = declarations.get(name)
    if (actual === undefined) errors.push(`${file} : ${name} manquante (attendu ${hex})`)
    else if (actual.toUpperCase() !== hex.toUpperCase()) errors.push(`${file} : ${name} = ${actual}, attendu ${hex}`)
  }
  for (const name of declarations.keys()) {
    if (!(name in expected)) errors.push(`${file} : ${name} n'appartient pas à la spécification`)
  }
}

async function load(relativePath) {
  return readFile(path.join(ROOT, relativePath), 'utf8')
}

// 1. Tokens métier : 7 types + 8 statuts
const colorsFile = 'tokens/colors.css'
const colors = readCustomProperties(colorsFile, await load(colorsFile))
expectExactly(colorsFile, colors, { ...TYPES, ...STATUSES })

// 2. Thèmes : 6 variables de fondation, CSS natif pur et exportable
for (const [file, expected] of Object.entries(THEMES)) {
  const css = await load(file)
  expectExactly(file, readCustomProperties(file, css), expected)
  const code = stripComments(css)
  if (/@import/i.test(code)) errors.push(`${file} : @import interdit (le thème doit être autonome)`)
  if (/url\(/i.test(code)) errors.push(`${file} : url() interdit (aucune ressource externe)`)
  if (/var\(/i.test(code)) errors.push(`${file} : var() interdit (valeurs littérales uniquement)`)
  if (/--(type|status)-/i.test(code)) errors.push(`${file} : variable métier --type-*/--status-* interdite dans un thème`)
}

// 3. Jetons dérivés et composants : uniquement des var() / color-mix() des couleurs officielles
const OFFICIAL = new Set([...Object.keys(TYPES), ...Object.keys(STATUSES), ...Object.keys(THEMES['themes/light.css'])])
const derivedFiles = [
  'tokens/ui.css',
  ...(await readdir(path.join(ROOT, 'components'))).filter((name) => name.endsWith('.css')).map((name) => `components/${name}`),
]
for (const file of derivedFiles) {
  const code = stripComments(await load(file))
  for (const [literal] of code.matchAll(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi)) {
    errors.push(`${file} : couleur littérale « ${literal} » interdite (dériver des variables du design system)`)
  }
  for (const [, name] of code.matchAll(/(--[\w-]+)\s*:/g)) {
    if (OFFICIAL.has(name)) errors.push(`${file} : ${name} est un token officiel, il ne se redéfinit pas ici`)
  }
}

if (errors.length > 0) {
  console.error(`✘ Design system NON conforme (${errors.length} écart${errors.length > 1 ? 's' : ''}) :`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(
  `✔ Design system conforme : ${Object.keys(TYPES).length} types, ${Object.keys(STATUSES).length} statuts, ` +
    `${Object.keys(THEMES).length} thèmes × ${Object.keys(THEMES['themes/light.css']).length} variables (codes hex officiels), ` +
    `${derivedFiles.length} fichiers dérivés sans couleur littérale.`,
)
