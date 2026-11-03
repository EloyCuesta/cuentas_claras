import { AsyncLocalStorage } from 'node:async_hooks'
import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from 'mysql2/promise'
import type { DatabaseConfig } from './config.ts'
import { DatabaseSetupError, explainDatabaseError } from './errors.ts'
import { runMigrations, type MigrationOptions } from './migrations.ts'

/**
 * La conexión con MySQL: un pool de mysql2 y la transacción en curso.
 *
 * - Fechas e instantes viajan como texto (dateStrings) y los DECIMAL como
 *   números (decimalNumbers). Un parámetro solo puede ser texto, número o null:
 *   nunca un Date (mysql2 lo convertiría con la zona horaria del equipo).
 * - Una sentencia por llamada (multipleStatements: false).
 * - Cada conexión nueva fija su sesión (SESSION_SETUP): colación
 *   utf8mb4_0900_bin también para los textos sueltos, modo estricto y
 *   REPEATABLE READ, aunque el servidor tenga otros valores por defecto.
 * - Dentro de MysqlUnitOfWork.run, `rows` y `run` usan la conexión de esa
 *   transacción (AsyncLocalStorage); fuera, el pool, con una conexión por
 *   sentencia.
 */

export type SqlParam = string | number | null

/** Lo que guarda la transacción en curso; solo lo usa MysqlUnitOfWork. */
export interface TransactionContext {
  connection: PoolConnection
  /** Bloqueos de app_locks ya tomados en esta transacción. */
  locks: Set<string>
  /** Para nombrar los savepoints de las llamadas anidadas. */
  savepoints: number
}

export const SESSION_SETUP =
  "SET character_set_client = utf8mb4, character_set_connection = utf8mb4, character_set_results = utf8mb4, " +
  'collation_connection = utf8mb4_0900_bin, ' +
  "sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION', " +
  "transaction_isolation = 'REPEATABLE-READ'"

function checkParams(params: readonly unknown[]): void {
  for (const value of params) {
    if (value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) continue
    throw new TypeError(`Parámetro SQL no admitido (${value instanceof Date ? 'Date' : typeof value}): usa texto, un número finito o null.`)
  }
}

export class MysqlDatabase {
  readonly pool: Pool
  readonly config: DatabaseConfig
  private readonly transactions = new AsyncLocalStorage<TransactionContext>()

  constructor(config: DatabaseConfig) {
    this.config = config
    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      decimalNumbers: true,
      dateStrings: true,
      multipleStatements: false,
      supportBigNumbers: false,
      // Sin IGNORE_SPACE: la sesión usa el mismo modo SQL que Workbench o .NET.
      flags: ['-IGNORE_SPACE'],
      // La del saludo inicial; SESSION_SETUP la cambia a utf8mb4_0900_bin (no cabe en el saludo).
      charset: 'UTF8MB4_0900_AI_CI',
      connectionLimit: 10,
      maxIdle: 10,
      idleTimeout: 60_000,
      connectTimeout: 10_000,
      enableKeepAlive: true,
      // Las listas IN (...) cambian la sentencia: así el servidor no acumula demasiadas preparadas.
      maxPreparedStatements: 256,
    })
    // mysql2 avisa de cada conexión nueva antes de entregarla: su primera orden es fijar la sesión.
    this.pool.pool.on('connection', (connection) => {
      connection.query(SESSION_SETUP, (error: unknown) => {
        if (error) connection.destroy()
      })
    })
  }

  /** Filas de una consulta, con parámetros. */
  async rows<T>(sql: string, params: readonly SqlParam[] = []): Promise<T[]> {
    checkParams(params)
    const [rows] = await this.executor().execute(sql, params as SqlParam[])
    return rows as T[]
  }

  /** Una sentencia que escribe, con parámetros. affectedRows cuenta las filas encontradas, aunque no cambien. */
  async run(sql: string, params: readonly SqlParam[] = []): Promise<ResultSetHeader> {
    checkParams(params)
    const [result] = await this.executor().execute(sql, params as SqlParam[])
    return result as ResultSetHeader
  }

  /** SELECT 1: lanza si MySQL no responde. */
  async ping(): Promise<void> {
    await this.pool.query('SELECT 1')
  }

  currentTransaction(): TransactionContext | undefined {
    return this.transactions.getStore()
  }

  /** Ejecuta `work` con `context` como transacción en curso (lo usa MysqlUnitOfWork). */
  withTransaction<T>(context: TransactionContext, work: () => Promise<T>): Promise<T> {
    return this.transactions.run(context, work)
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  private executor(): Pool | PoolConnection {
    return this.transactions.getStore()?.connection ?? this.pool
  }
}

export interface OpenedDatabase {
  db: MysqlDatabase
  schemaVersion: number
}

/**
 * Conecta con MySQL y deja la base lista: comprueba que responde y aplica las
 * migraciones pendientes (database/mysql/). Si algo falla, cierra el pool y
 * lanza DatabaseSetupError con lo que hay que revisar, sin la contraseña.
 */
export async function openDatabase(config: DatabaseConfig, options: MigrationOptions = {}): Promise<OpenedDatabase> {
  const db = new MysqlDatabase(config)
  try {
    await db.ping()
    const schemaVersion = await runMigrations(db, options)
    return { db, schemaVersion }
  } catch (error) {
    await db.close().catch(() => {})
    throw new DatabaseSetupError(explainDatabaseError(error, config))
  }
}
