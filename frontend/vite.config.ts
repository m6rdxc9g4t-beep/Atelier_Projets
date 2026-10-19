// Vite : React + Tailwind CSS v4. En développement, /api est relayé vers le backend Fastify
// (http://127.0.0.1:3000 par défaut, ou ATELIER_API_URL) : même origine, aucune configuration CORS.
// Ports de la Suite Atelier (docs/SUITE.md §2) : interface 5174, aperçu 4174 ; strictPort : en cas de
// conflit, Vite échoue au lieu de prendre un autre port (les autres applications pointent sur ceux-ci).
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const apiTarget = process.env.ATELIER_API_URL ?? 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
