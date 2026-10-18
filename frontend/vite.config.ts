// Vite : React + Tailwind CSS v4. En développement, /api est relayé vers le backend Fastify
// (http://127.0.0.1:3000 par défaut, ou ATELIER_API_URL) : même origine, aucune configuration CORS.
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const apiTarget = process.env.ATELIER_API_URL ?? 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
})
