// Tests de navigateur (Playwright) : API sur une base temporaire + interface Vite, sur des ports dédiés
// (un « npm run dev » ouvert à côté n'est pas touché). Première fois : npm run test:e2e:install
import { defineConfig, devices } from '@playwright/test'

const API_PORT = Number(process.env.E2E_API_PORT ?? 3100)
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5180)

export default defineConfig({
  testDir: 'e2e',
  // Une seule base et un seul chronomètre pour toute la suite : pas de parallélisme.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? 'line' : 'list',
  outputDir: 'e2e/.results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    viewport: { width: 1512, height: 945 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node --import tsx e2e/server.mts',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { E2E_API_PORT: String(API_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run dev --workspace=@atelier/frontend -- --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { ATELIER_API_URL: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
