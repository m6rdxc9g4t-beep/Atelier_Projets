// Vite : React + Tailwind CSS v4. En développement, /api est relayé vers le backend Fastify
// (http://127.0.0.1:3000 par défaut, ou ATELIER_API_URL) : même origine, aucune configuration CORS.
// Ports de la Suite Atelier (docs/SUITE.md §2) : interface 5174, aperçu 4174 ; strictPort : en cas de
// conflit, Vite échoue au lieu de prendre un autre port (les autres applications pointent sur ceux-ci).
// Thème (docs/SUITE.md §1.5) : le script commun design-system/brand/atelier-theme.js est injecté tel quel dans
// le <head> de index.html, script bloquant avant l'affichage (pas de copie à tenir à jour, pas d'éclair clair → sombre).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const THEME_MARKER = /<!-- atelier-theme\b[^>]*-->/

function atelierTheme(): Plugin {
  const file = createRequire(import.meta.url).resolve('@atelier/design-system/brand/atelier-theme.js')
  return {
    name: 'atelier-theme',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!THEME_MARKER.test(html)) throw new Error('index.html : repère <!-- atelier-theme --> introuvable')
        const script = readFileSync(file, 'utf8').replaceAll('</script', '<\\/script')
        return html.replace(THEME_MARKER, () => `<script>\n${script}</script>`)
      },
    },
  }
}

const apiTarget = process.env.ATELIER_API_URL ?? 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [atelierTheme(), react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  preview: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
})
