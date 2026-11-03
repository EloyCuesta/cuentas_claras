import { randomBytes } from 'node:crypto'
import mysql, { type Connection } from 'mysql2/promise'
import { DEFAULT_HOST, DEFAULT_PORT, TEST_DATABASE_PREFIX, type DatabaseConfig } from '../mysql/config.ts'
import { openDatabase, type OpenedDatabase } from '../mysql/MysqlDatabase.ts'
import type { MigrationOptions } from '../mysql/migrations.ts'

/**
 * Bases de datos MySQL para los tests: cada una se llama
 * cuentas_test_<aleatorio>, se crea con las CUENTAS_DB_* (sin mirar
 * CUENTAS_DB_NAME) y se borra al terminar con dropTestDatabases(). Nunca se usa
 * cuentas_claras. Si MySQL no está, los tests fallan con un mensaje claro: no
 * se saltan.
 */

const created: string[] = []
const opened: OpenedDatabase[] = []
const connections: Connection[] = []

/** Servidor, usuario y contraseña de las pruebas (CUENTAS_DB_*), sin base de datos. */
function serverConfig(): Omit<DatabaseConfig, 'database'> {
  const user = process.env.CUENTAS_DB_USER?.trim()
  if (!user) {
    throw new Error(
      'Las pruebas necesitan MySQL: falta CUENTAS_DB_USER (y CUENTAS_DB_PASSWORD). Ponlos en .env o en el entorno, ' +
        'con un usuario que pueda crear y borrar las bases cuentas_test_% (README, «Pruebas»).',
    )
  }
  return {
    host: process.env.CUENTAS_DB_HOST?.trim() || DEFAULT_HOST,
    port: Number(process.env.CUENTAS_DB_PORT?.trim() || DEFAULT_PORT),
    user,
    password: process.env.CUENTAS_DB_PASSWORD ?? '',
  }
}

/** La configuración de una base de pruebas, como la leería el servidor. */
export function testDatabaseConfig(database: string): DatabaseConfig {
  return { ...serverConfig(), database }
}

async function adminConnection(): Promise<Connection> {
  const config = serverConfig()
  try {
    return await mysql.createConnection({ ...config, multipleStatements: false })
  } catch (error) {
    const code = (error as { code?: string }).code ?? (error instanceof Error ? error.message : String(error))
    throw new Error(
      `Las pruebas necesitan MySQL y no se puede conectar con ${config.user}@${config.host}:${config.port} (${code}). ` +
        'Arranca MySQL Server y revisa CUENTAS_DB_HOST, CUENTAS_DB_PORT, CUENTAS_DB_USER y CUENTAS_DB_PASSWORD (README, «Pruebas»).',
      { cause: error },
    )
  }
}

/** Crea una base vacía (sin tablas) y devuelve su nombre. */
export async function createTestDatabase(): Promise<string> {
  const name = `${TEST_DATABASE_PREFIX}${randomBytes(8).toString('hex')}`
  const admin = await adminConnection()
  try {
    // El nombre lo genera este archivo (prefijo y hexadecimal): no lleva datos de nadie.
    await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`)
  } finally {
    await admin.end()
  }
  created.push(name)
  return name
}

/** Una base de pruebas con el esquema ya aplicado (por defecto, nueva y con las categorías iniciales). */
export async function openTestDatabase(name?: string, options?: MigrationOptions): Promise<OpenedDatabase & { name: string }> {
  const database = name ?? (await createTestDatabase())
  const result = await openDatabase(testDatabaseConfig(database), options)
  opened.push(result)
  return { ...result, name: database }
}

/** Una conexión suelta a una base de pruebas, para mirar o preparar tablas a mano. */
export async function connectTestDatabase(name: string): Promise<Connection> {
  const connection = await mysql.createConnection({ ...testDatabaseConfig(name), dateStrings: true, decimalNumbers: true, multipleStatements: false })
  connections.push(connection)
  return connection
}

/** Para afterEach: cierra lo que se abrió con estos ayudantes y borra las bases creadas. */
export async function dropTestDatabases(): Promise<void> {
  for (const connection of connections.splice(0)) await connection.end().catch(() => {})
  for (const { db } of opened.splice(0)) await db.close().catch(() => {})
  const names = created.splice(0)
  if (names.length === 0) return
  const admin = await adminConnection()
  try {
    for (const name of names) await admin.query(`DROP DATABASE IF EXISTS \`${name}\``)
  } finally {
    await admin.end()
  }
}
