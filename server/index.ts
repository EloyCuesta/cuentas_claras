import { createServer } from 'node:http'
import { createApp } from './app.ts'
import { describeDatabase, isTestDatabaseName, readDatabaseConfig } from './common/mysql/config.ts'
import { DatabaseSetupError } from './common/mysql/errors.ts'
import { openDatabase, type OpenedDatabase } from './common/mysql/MysqlDatabase.ts'
import { checkAccessCode } from './modules/auth/index.ts'
import { createTesseractReader } from './modules/tickets/index.ts'

/**
 * Servidor de Cuentas claras: la API REST sobre MySQL.
 *
 * Variables de entorno. Los scripts de package.json las leen también del
 * archivo .env, si existe (ver .env.example); las del entorno tienen prioridad.
 *
 * Obligatorias:
 * - CUENTAS_CODIGO       código de acceso a las finanzas (al menos 4 caracteres). Sin él
 *                        el servidor no arranca ni conecta con MySQL. Quien no lo sepa
 *                        solo puede usar la despensa.
 * - CUENTAS_DB_USER      usuario de MySQL, con CUENTAS_DB_PASSWORD (su contraseña).
 *
 * Opcionales:
 * - CUENTAS_DB_HOST      servidor de MySQL (por defecto 127.0.0.1)
 * - CUENTAS_DB_PORT      puerto de MySQL (por defecto 3306)
 * - CUENTAS_DB_NAME      base de datos, que tiene que existir (por defecto cuentas_claras)
 * - CUENTAS_PORT         puerto de la API (por defecto 3001)
 * - CUENTAS_HOST         dirección (por defecto 127.0.0.1: solo accesible desde este equipo)
 * - CUENTAS_TEST=1       modo pruebas: activa POST /api/test/reset y solo arranca contra
 *                        cuentas_claras_e2e o una base cuentas_test_*
 */

function fail(message: string): never {
  console.error(`[api] ${message}`)
  process.exit(1)
}

// Lo primero: sin un código válido no se conecta con MySQL.
const accessCode = checkAccessCode(process.env.CUENTAS_CODIGO)
if (!accessCode.ok) fail(accessCode.message)

const databaseConfig = readDatabaseConfig(process.env)
if (!databaseConfig.ok) fail(databaseConfig.message)
const config = databaseConfig.config

const port = Number(process.env.CUENTAS_PORT ?? 3001)
const host = process.env.CUENTAS_HOST ?? '127.0.0.1'
const testMode = process.env.CUENTAS_TEST === '1'

// El modo pruebas vacía la base con POST /api/test/reset: nunca contra la de uso diario.
if (testMode && !isTestDatabaseName(config.database)) {
  fail(
    `Con CUENTAS_TEST=1 el servidor solo usa la base de las pruebas (cuentas_claras_e2e) o una cuentas_test_*, ` +
      `nunca «${config.database}»: sus datos se borrarían. Quita CUENTAS_TEST o cambia CUENTAS_DB_NAME.`,
  )
}

if (process.env.CUENTAS_DB_PATH) {
  console.warn(
    '[api] CUENTAS_DB_PATH ya no se usa: los datos están en MySQL (CUENTAS_DB_*). Para pasar los de una copia de cuentas.db, ' +
      'usa el importador (README, «Pasar los datos de SQLite a MySQL»).',
  )
}

let database: OpenedDatabase
try {
  database = await openDatabase(config)
} catch (error) {
  fail(error instanceof DatabaseSetupError ? error.message : `No se puede usar la base de datos ${describeDatabase(config)}.`)
}

const ticketReader = createTesseractReader()
const server = createServer(createApp({ database, accessCode: accessCode.code, testMode, ticketReader }))

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[api] El puerto ${port} ya está en uso. ¿Hay otro «npm run dev» abierto? Ciérralo o elige otro con CUENTAS_PORT.`)
  } else {
    console.error('[api]', error)
  }
  void database.db.close().finally(() => process.exit(1))
})

server.listen(port, host, () => {
  console.log(`[api] Cuentas claras escuchando en http://${host}:${port}/api`)
  console.log(`[api] Base de datos MySQL: ${describeDatabase(config)} (esquema ${database.schemaVersion})${testMode ? ' · MODO PRUEBAS' : ''}`)
})

// Al cerrar (Ctrl+C), se terminan las peticiones en curso, se cierra el lector y después las conexiones con MySQL.
let closing = false
function shutdown() {
  if (closing) return
  closing = true
  server.close(() => {
    void ticketReader
      .close()
      .finally(() => database.db.close())
      .finally(() => process.exit(0))
  })
  setTimeout(() => {
    void database.db.close().finally(() => process.exit(0))
  }, 2000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
