import mysql from 'mysql2/promise'
import { describeDatabase, E2E_DATABASE, readDatabaseConfig } from '../server/common/mysql/config.ts'
import { explainDatabaseError } from '../server/common/mysql/errors.ts'

/**
 * Antes de arrancar el servidor de las pruebas en navegador (playwright.config.ts):
 * crea la base cuentas_claras_e2e si todavía no existe, con utf8mb4_0900_bin,
 * usando el servidor, el usuario y la contraseña de CUENTAS_DB_* (del entorno o
 * de .env). Solo esa base: ni la mira ni la crea con otro nombre. Sus tablas
 * las crea el propio servidor al arrancar, y cada prueba la vacía con
 * POST /api/test/reset.
 */

const result = readDatabaseConfig({ ...process.env, CUENTAS_DB_NAME: E2E_DATABASE })
if (!result.ok) {
  console.error(`[e2e] ${result.message}`)
  process.exit(1)
}
const { database, ...server } = result.config

try {
  const connection = await mysql.createConnection({ ...server, multipleStatements: false })
  try {
    // El nombre es la constante E2E_DATABASE: no viene de fuera.
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`)
  } finally {
    await connection.end()
  }
  console.log(`[e2e] Base de las pruebas lista: ${describeDatabase(result.config)}`)
} catch (error) {
  console.error(`[e2e] ${explainDatabaseError(error, result.config)}`)
  process.exit(1)
}
