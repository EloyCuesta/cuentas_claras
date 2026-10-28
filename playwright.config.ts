import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

/**
 * Pruebas de extremo a extremo en un navegador real (Chromium).
 * Antes de la primera ejecución: npx playwright install chromium
 *
 * Usan su propio servidor de API (puerto 3101) con su propia base de datos en la
 * carpeta temporal del sistema, y su propia web (puerto 4174) apuntada a él.
 * Nunca se reutiliza un servidor ya abierto, así que no pueden tocar los datos
 * reales (server/data/cuentas.db) ni el servidor de npm run dev.
 */
const API_PORT = 3101
const WEB_PORT = 4174
const TEST_DB = join(tmpdir(), 'cuentas-claras-e2e', 'cuentas.db')

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // Todas comparten la base de datos de pruebas: van de una en una y cada una la vacía al empezar.
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}/`,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] } },
    { name: 'movil', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'npm run server',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { CUENTAS_PORT: String(API_PORT), CUENTAS_DB_PATH: TEST_DB, CUENTAS_TEST: '1' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run build && npm run preview -- --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}/`,
      env: { CUENTAS_API_URL: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
