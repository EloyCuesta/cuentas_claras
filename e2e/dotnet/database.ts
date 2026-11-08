import mysql from 'mysql2/promise'
import { readDatabaseConfig, type DatabaseConfig } from '../../server/common/mysql/config.ts'
import { DEFAULT_CATEGORIES } from '../../shared/finance/categories.ts'

/**
 * La base de la app completa contra .NET (playwright.dotnet.config.ts): solo esta, que cubren los permisos de
 * pruebas (`cuentas\_test\_%`, README «Pruebas»). El host .NET no tiene ruta de reinicio, así que las pruebas la
 * preparan y la vacían desde aquí, con SQL directo y fuera de la API. Nunca toca otra base.
 */
export const DOTNET_E2E_DATABASE = 'cuentas_test_e2e_dotnet'

function config(): DatabaseConfig {
  const result = readDatabaseConfig({ ...process.env, CUENTAS_DB_NAME: DOTNET_E2E_DATABASE })
  if (!result.ok) throw new Error(`[e2e .NET] ${result.message}`)
  return result.config
}

async function withServer<T>(work: (connection: mysql.Connection) => Promise<T>): Promise<T> {
  const { database: _database, ...server } = config()
  const connection = await mysql.createConnection({ ...server, multipleStatements: false })
  try {
    return await work(connection)
  } finally {
    await connection.end()
  }
}

/** Antes de arrancar el host: la base vacía, con la colación de la aplicación. Sus tablas las crea el host al migrar. */
export function createDotnetDatabase(): Promise<void> {
  // El nombre es la constante de arriba: no viene de fuera.
  return withServer(async (connection) => {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DOTNET_E2E_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`)
  })
}

/** Al terminar la suite. */
export function dropDotnetDatabase(): Promise<void> {
  return withServer(async (connection) => {
    await connection.query(`DROP DATABASE IF EXISTS \`${DOTNET_E2E_DATABASE}\``)
  })
}

/** Las tablas en el orden de sus claves foráneas: primero lo que apunta a otras. */
const TABLES = [
  'pantry_ticket_lines', 'pantry_tickets', 'pantry_aliases', 'pantry_events', 'pantry_items', 'pantry_people', 'pantry_settings',
  'movements', 'recurring_excluded_dates', 'recurring_rules', 'categories', 'meta',
] as const

/**
 * Lo mismo que POST /api/test/reset de Express: la base como recién creada (las categorías iniciales y nada más), en
 * una transacción con los bloqueos de finanzas y de tickets. Comprueba antes que la conexión está en la base del ensayo.
 */
export async function resetDotnetDatabase(): Promise<void> {
  const settings = config()
  const connection = await mysql.createConnection({ ...settings, multipleStatements: false })
  try {
    const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT DATABASE() AS name')
    if (rows[0]?.name !== DOTNET_E2E_DATABASE) throw new Error(`[e2e .NET] La conexión no está en ${DOTNET_E2E_DATABASE}: no se vacía nada.`)
    await connection.beginTransaction()
    try {
      await connection.query("SELECT name FROM app_locks WHERE name IN ('finance', 'tickets') ORDER BY name FOR UPDATE")
      for (const table of TABLES) await connection.query(`DELETE FROM ${table}`)
      // DEFAULT_CATEGORIES pone cada principal antes que sus subcategorías (clave foránea parent_id).
      for (const category of DEFAULT_CATEGORIES) {
        await connection.execute(
          'INSERT INTO categories (id, name, type, parent_id, order_index, budget_cents) VALUES (?, ?, ?, ?, ?, ?)',
          [category.id, category.name, category.type, category.parentId, category.order, category.budgetCents],
        )
      }
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    }
  } finally {
    await connection.end()
  }
}
