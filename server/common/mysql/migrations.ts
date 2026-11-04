import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { DEFAULT_CATEGORIES } from '#shared/finance/categories.ts'
import { DatabaseSetupError } from './errors.ts'
import type { MysqlDatabase } from './MysqlDatabase.ts'

/**
 * Migraciones de MySQL: los archivos .sql de database/mysql/migrations/, con
 * su historial en schema_migrations (database/mysql/schema_migrations.sql).
 * Son el esquema que reutilizará .NET: aquí solo se leen y se aplican.
 *
 * - Cada archivo se llama NNN-que-hace.sql (NNN es la versión) y se aplica
 *   una sola vez, en orden. Una migración publicada no se edita.
 * - El DDL de MySQL se confirma solo: antes de empezar se anota la migración
 *   sin applied_at y al terminar se completa. Una fila sin applied_at es una
 *   migración a medias: se explica y no se continúa.
 * - Las categorías iniciales solo se crean en una base nueva y si se pide
 *   (la aplicación sí, el importador no), en la misma transacción que completa
 *   la migración.
 * - Una base de una versión más nueva, o con tablas pero sin historial, no se toca.
 */

const MYSQL_FOLDER = fileURLToPath(new URL('../../../database/mysql/', import.meta.url))
const MIGRATION_FILE = /^(\d{3})-([a-z0-9]+(?:-[a-z0-9]+)*)\.sql$/

/** La versión cuya migración crea las categorías: tras ella se siembran en una base nueva. */
const SEED_VERSION = 5

export interface MysqlMigration {
  version: number
  /** El nombre del archivo, con espacios: «esquema inicial». */
  name: string
  file: string
  statements: string[]
}

/**
 * Las sentencias de un archivo .sql: quita las líneas de comentario («--» al
 * principio) y corta en cada «;» al final de una línea. Lanza si algo queda sin «;».
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current: string[] = []
  for (const line of sql.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*--/.test(line)) continue
    current.push(line)
    if (/;\s*$/.test(line)) {
      const statement = current.join('\n').replace(/;\s*$/, '').trim()
      if (statement) statements.push(statement)
      current = []
    }
  }
  const rest = current.join('\n').trim()
  if (rest) throw new Error(`Falta el «;» final de una sentencia: «${rest.slice(0, 60)}…»`)
  return statements
}

export function loadMigrations(folder = `${MYSQL_FOLDER}migrations/`): MysqlMigration[] {
  return readdirSync(folder)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => {
      const match = MIGRATION_FILE.exec(file)
      if (!match) throw new Error(`Nombre de migración no válido: ${file} (debe ser NNN-que-hace.sql)`)
      return { version: Number(match[1]), name: match[2].replaceAll('-', ' '), file, statements: splitStatements(readFileSync(`${folder}${file}`, 'utf8')) }
    })
}

export const MIGRATIONS: readonly MysqlMigration[] = loadMigrations()
export const LATEST_VERSION = MIGRATIONS.at(-1)?.version ?? 0
const HISTORY_STATEMENTS = splitStatements(readFileSync(`${MYSQL_FOLDER}schema_migrations.sql`, 'utf8'))

export interface MigrationOptions {
  /** Crear las categorías iniciales si la base estaba vacía. Por defecto sí; el importador pasa false. */
  seedNewDatabase?: boolean
  /** Instante de started_at y applied_at (por defecto, ahora). */
  now?: () => string
  /** Otra lista de migraciones: solo para probar una que falla a medias. */
  migrations?: readonly MysqlMigration[]
}

interface HistoryRow extends RowDataPacket {
  version: number
  name: string
  started_at: string
  applied_at: string | null
}

/** Aplica las migraciones pendientes y devuelve la versión del esquema. */
export async function runMigrations(db: MysqlDatabase, options: MigrationOptions = {}): Promise<number> {
  const connection = await db.pool.getConnection()
  // Dos procesos que arrancan a la vez no migran a la vez: GET_LOCK es por sesión y por base.
  const lock = `cuentas_claras_migraciones_${createHash('sha256').update(db.config.database).digest('hex').slice(0, 24)}`
  try {
    const [[got]] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, 60) AS got', [lock])
    if (got.got !== 1) {
      throw new DatabaseSetupError(`Otro proceso lleva más de un minuto preparando la base de datos «${db.config.database}». Ciérralo y vuelve a arrancar.`)
    }
    try {
      return await migrate(connection, db.config.database, options)
    } finally {
      await connection.query('SELECT RELEASE_LOCK(?)', [lock])
    }
  } finally {
    connection.release()
  }
}

async function migrate(
  connection: PoolConnection,
  database: string,
  { seedNewDatabase = true, now = () => new Date().toISOString(), migrations = MIGRATIONS }: MigrationOptions,
): Promise<number> {
  const latest = migrations.at(-1)?.version ?? 0
  const [tables] = await connection.query<RowDataPacket[]>(
    'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME',
  )
  const names = tables.map((table) => String(table.name))
  const foreign = names.filter((name) => name !== 'schema_migrations')
  if (!names.includes('schema_migrations') && foreign.length > 0) throw withoutHistory(database, foreign)
  for (const statement of HISTORY_STATEMENTS) await connection.query(statement)

  const [history] = await connection.query<HistoryRow[]>('SELECT version, name, started_at, applied_at FROM schema_migrations ORDER BY version')
  const unfinished = history.find((row) => row.applied_at === null)
  if (unfinished) {
    throw new DatabaseSetupError(
      `La migración ${unfinished.version} («${unfinished.name}») empezó el ${unfinished.started_at} y no terminó. ` +
        `El DDL de MySQL se confirma solo, así que la base «${database}» puede tener solo parte de sus cambios, y no se continúa. ` +
        'Restaura la copia de la base o, si era nueva, bórrala y créala vacía otra vez (README, «Preparar MySQL»).',
    )
  }
  if (history.length === 0 && foreign.length > 0) throw withoutHistory(database, foreign)
  const newest = Math.max(0, ...history.map((row) => row.version))
  if (newest > latest) {
    throw new DatabaseSetupError(
      `La base de datos «${database}» es de una versión más nueva de Cuentas claras (esquema ${newest}). Actualiza la aplicación antes de abrirla.`,
    )
  }

  const isNew = history.length === 0
  for (const migration of migrations) {
    if (migration.version <= newest) continue
    await connection.query('INSERT INTO schema_migrations (version, name, started_at, applied_at) VALUES (?, ?, ?, NULL)', [
      migration.version,
      migration.name,
      now(),
    ])
    for (const [index, statement] of migration.statements.entries()) {
      try {
        await connection.query(statement)
      } catch (error) {
        throw new DatabaseSetupError(
          `La migración ${migration.version} («${migration.name}») ha fallado en la sentencia ${index + 1} de ${migration.statements.length}: ` +
            `${error instanceof Error ? error.message : String(error)}. Ha quedado a medias en «${database}»: corrige la causa y vuelve a empezar con una base vacía.`,
        )
      }
    }
    await connection.query('START TRANSACTION')
    try {
      if (isNew && seedNewDatabase && migration.version === SEED_VERSION) await seedCategories(connection)
      await connection.query('UPDATE schema_migrations SET applied_at = ? WHERE version = ?', [now(), migration.version])
      await connection.query('COMMIT')
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => {})
      throw error
    }
  }
  return latest
}

function withoutHistory(database: string, tables: string[]): DatabaseSetupError {
  return new DatabaseSetupError(
    `La base de datos «${database}» tiene tablas (${tables.join(', ')}) pero no el historial de Cuentas claras (schema_migrations): ` +
      'no se aplica el esquema encima. Usa una base vacía para la aplicación.',
  )
}

/** Las categorías iniciales, como la migración 001 de SQLite: las principales antes que sus subcategorías. */
async function seedCategories(connection: PoolConnection): Promise<void> {
  for (const category of DEFAULT_CATEGORIES) {
    await connection.execute('INSERT INTO categories (id, name, type, parent_id, order_index, budget_cents) VALUES (?, ?, ?, ?, ?, ?)', [
      category.id,
      category.name,
      category.type,
      category.parentId,
      category.order,
      category.budgetCents,
    ])
  }
}
