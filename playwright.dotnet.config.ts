import { defineConfig, devices } from '@playwright/test'
import { loadEnv } from 'vite'
import { E2E_CODE } from './e2e/auth.ts'
import { DOTNET_E2E_DATABASE } from './e2e/dotnet/database.ts'
import { DOTNET_E2E_CODE } from './e2e/dotnet/settings.ts'

/**
 * El ensayo React/.NET, en dos partes. Requiere la soluciÃ³n .NET compilada (`npm run build:dotnet`).
 *
 * - Acceso (proyectos acceso-*): el host .NET sin base de datos (3202) y la pÃ¡gina aislada de e2e/dotnet/ (4175).
 * - La app completa (proyectos app-*): el host .NET con MySQL (3203), sobre su propia base de ensayo
 *   (cuentas_test_e2e_dotnet, que se crea antes de arrancar, se vacÃ­a antes de cada prueba con SQL directo y se borra al
 *   terminar), y la web real construida con CUENTAS_BACKEND=dotnet en dist-dotnet y servida en 4176. Ejecuta los mismos
 *   e2e/*.spec.ts que Express (los marcados @dotnet, a medida que cada ID se migra) y los de e2e/dotnet/app/.
 *
 * Nunca se reutiliza un servidor abierto ni se toca la base cuentas_claras. El servidor, el usuario y la contraseÃ±a de
 * MySQL son los de CUENTAS_DB_* (del entorno o de .env, como Vitest); el host .NET no lee .env, asÃ­ que se le pasan aquÃ­.
 */
Object.assign(process.env, loadEnv('test', process.cwd(), 'CUENTAS_DB_'), { CUENTAS_E2E_BACKEND: 'dotnet' })

const DOTNET = 'dotnet run --no-build --project backend/src/CuentasClaras.Api/CuentasClaras.Api.csproj'
const ACCESS = { api: 3202, web: 4175 }
const APP = { api: 3203, web: 4176 }

export default defineConfig({
  timeout: 30_000,
  // La app comparte su base de ensayo: de una en una, y cada prueba la vacÃ­a al empezar.
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  globalTeardown: './e2e/dotnet/teardown.ts',
  use: {
    ...(process.env.CUENTAS_E2E_CHANNEL ? { channel: process.env.CUENTAS_E2E_CHANNEL } : {}),
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'acceso-escritorio', testDir: './e2e/dotnet', testMatch: '**/auth.spec.ts', use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${ACCESS.web}/` } },
    { name: 'acceso-movil', testDir: './e2e/dotnet', testMatch: '**/auth.spec.ts', use: { ...devices['Pixel 7'], baseURL: `http://127.0.0.1:${ACCESS.web}/` } },
    // Las de Express que ya tienen todas sus rutas en .NET llevan la etiqueta @dotnet.
    { name: 'app-escritorio', testDir: './e2e', testIgnore: '**/dotnet/auth.spec.ts', grep: /@dotnet/, use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${APP.web}/` } },
    { name: 'app-movil', testDir: './e2e', testIgnore: '**/dotnet/auth.spec.ts', grep: /@dotnet/, use: { ...devices['Pixel 7'], baseURL: `http://localhost:${APP.web}/` } },
  ],
  webServer: [
    {
      command: DOTNET,
      url: `http://127.0.0.1:${ACCESS.api}/api/auth/me`,
      // Playwright aÃ±ade estas variables a las del entorno: CUENTAS_DB_USER vacÃ­o deja este host solo con el acceso,
      // aunque quien lo lance tenga CUENTAS_DB_* (si no, abrirÃ­a y migrarÃ­a su base, por defecto cuentas_claras).
      env: { CUENTAS_HOST: '127.0.0.1', CUENTAS_PORT: String(ACCESS.api), CUENTAS_CODIGO: DOTNET_E2E_CODE, CUENTAS_DB_USER: '' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npx vite --config e2e/dotnet/vite.config.ts',
      url: `http://127.0.0.1:${ACCESS.web}/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `node --import tsx e2e/dotnet/prepareDatabase.ts && ${DOTNET}`,
      url: `http://127.0.0.1:${APP.api}/api/health`,
      // El nombre de la base se fuerza siempre: nunca la de CUENTAS_DB_NAME del entorno o de .env.
      env: { CUENTAS_HOST: '127.0.0.1', CUENTAS_PORT: String(APP.api), CUENTAS_CODIGO: E2E_CODE, CUENTAS_DB_NAME: DOTNET_E2E_DATABASE },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx vite build --outDir dist-dotnet --emptyOutDir && npx vite preview --outDir dist-dotnet --port ${APP.web} --strictPort`,
      url: `http://localhost:${APP.web}/`,
      env: { CUENTAS_API_URL: `http://127.0.0.1:${APP.api}`, CUENTAS_BACKEND: 'dotnet' },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})
