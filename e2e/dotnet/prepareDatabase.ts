import { createDotnetDatabase, DOTNET_E2E_DATABASE } from './database.ts'

/**
 * Antes de arrancar el host .NET de la app completa (playwright.dotnet.config.ts): crea su base de ensayo si falta,
 * con las CUENTAS_DB_* del entorno o de .env. Sus tablas las crea el host al aplicar database/mysql/.
 */
try {
  await createDotnetDatabase()
  console.log(`[e2e .NET] Base de las pruebas lista: ${DOTNET_E2E_DATABASE}`)
} catch (error) {
  console.error(`[e2e .NET] No se puede preparar ${DOTNET_E2E_DATABASE}: ${(error as Error).message}`)
  process.exit(1)
}
