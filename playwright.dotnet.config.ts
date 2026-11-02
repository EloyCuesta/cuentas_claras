import { defineConfig, devices } from '@playwright/test'
import { DOTNET_E2E_CODE } from './e2e/dotnet/settings.ts'

/** Acceso React/.NET aislado del backend Express y de cualquier base de datos; requiere build .NET previo. */
export default defineConfig({
  testDir: './e2e/dotnet',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    ...(process.env.CUENTAS_E2E_CHANNEL ? { channel: process.env.CUENTAS_E2E_CHANNEL } : {}),
    baseURL: 'http://127.0.0.1:4175/',
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
      command: 'dotnet run --no-build --project backend/src/CuentasClaras.Api/CuentasClaras.Api.csproj',
      url: 'http://127.0.0.1:3202/api/auth/me',
      env: { CUENTAS_HOST: '127.0.0.1', CUENTAS_PORT: '3202', CUENTAS_CODIGO: DOTNET_E2E_CODE },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npx vite --config e2e/dotnet/vite.config.ts',
      url: 'http://127.0.0.1:4175/',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
