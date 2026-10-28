import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createApp } from './app.ts'
import { DEFAULT_DB_PATH, openDatabase, type OpenedDatabase } from './database.ts'
import { SqliteFinanceRepository } from './repository.ts'

/**
 * Servidor de Cuentas claras: la API REST sobre SQLite.
 *
 * Variables de entorno (todas opcionales):
 * - CUENTAS_DB_PATH  archivo de la base de datos (por defecto server/data/cuentas.db)
 * - CUENTAS_PORT     puerto (por defecto 3001)
 * - CUENTAS_HOST     dirección (por defecto 127.0.0.1: solo accesible desde este equipo)
 * - CUENTAS_TEST=1   modo pruebas: activa POST /api/test/reset
 */
const port = Number(process.env.CUENTAS_PORT ?? 3001)
const host = process.env.CUENTAS_HOST ?? '127.0.0.1'
const dbPath = process.env.CUENTAS_DB_PATH ? resolve(process.env.CUENTAS_DB_PATH) : DEFAULT_DB_PATH
const testMode = process.env.CUENTAS_TEST === '1'

let database: OpenedDatabase
try {
  database = openDatabase(dbPath)
} catch (error) {
  console.error(`[api] No se puede abrir la base de datos ${dbPath}:`, error instanceof Error ? error.message : error)
  process.exit(1)
}

const repository = new SqliteFinanceRepository(database.db)
const server = createServer(createApp({ database, repository, testMode }))

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[api] El puerto ${port} ya está en uso. ¿Hay otro «npm run dev» abierto? Ciérralo o elige otro con CUENTAS_PORT.`)
  } else {
    console.error('[api]', error)
  }
  database.db.close()
  process.exit(1)
})

server.listen(port, host, () => {
  console.log(`[api] Cuentas claras escuchando en http://${host}:${port}/api`)
  console.log(`[api] Base de datos: ${database.path} (esquema ${database.schemaVersion})${testMode ? ' · MODO PRUEBAS' : ''}`)
})

// Al cerrar (Ctrl+C), se terminan las peticiones en curso y se cierra la base de datos.
let closing = false
function shutdown() {
  if (closing) return
  closing = true
  server.close(() => {
    database.db.close()
    process.exit(0)
  })
  setTimeout(() => {
    database.db.close()
    process.exit(0)
  }, 2000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
