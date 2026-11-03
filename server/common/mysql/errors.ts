import { describeDatabase, type DatabaseConfig } from './config.ts'

/**
 * Los errores de MySQL que la aplicación entiende. mysql2 los da con `errno`
 * (el número de MySQL), `code` y `sqlMessage`.
 */

interface MysqlError {
  errno: number
  code?: string
  sqlMessage?: string
}

function isMysqlError(error: unknown): error is MysqlError {
  return typeof error === 'object' && error !== null && typeof (error as { errno?: unknown }).errno === 'number'
}

/** Errores de MySQL que equivalen a SQLITE_CONSTRAINT y se responden con 409. */
export const CONSTRAINT_ERRNOS: ReadonlySet<number> = new Set([
  1062, // ER_DUP_ENTRY: clave primaria o índice único repetidos
  1451, // ER_ROW_IS_REFERENCED_2: borrar algo que otra fila usa (RESTRICT)
  1452, // ER_NO_REFERENCED_ROW_2: apuntar a algo que no existe
  3819, // ER_CHECK_CONSTRAINT_VIOLATED
  1048, // ER_BAD_NULL_ERROR: NOT NULL, como SQLITE_CONSTRAINT_NOTNULL
])

export function isConstraintViolation(error: unknown): boolean {
  return isMysqlError(error) && CONSTRAINT_ERRNOS.has(error.errno)
}

/** ER_LOCK_DEADLOCK: InnoDB ya ha deshecho la transacción entera, que se puede repetir. */
export function isDeadlock(error: unknown): boolean {
  return isMysqlError(error) && error.errno === 1213
}

/** El índice de un ER_DUP_ENTRY («… for key 'movements.movements_occurrence'» → «movements_occurrence»). */
export function duplicateKeyName(error: unknown): string | null {
  if (!isMysqlError(error) || error.errno !== 1062) return null
  return /for key '(?:[^'.]+\.)?([^']+)'/.exec(error.sqlMessage ?? '')?.[1] ?? null
}

/** No se puede preparar la base de datos: el mensaje, en español, se puede enseñar tal cual. */
export class DatabaseSetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseSetupError'
  }
}

const NOT_REACHABLE = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EAI_AGAIN', 'PROTOCOL_CONNECTION_LOST'])

/**
 * Explica en español por qué no se puede usar la base de datos y qué revisar.
 * Nunca incluye la contraseña (mysql2 tampoco la pone en sus mensajes).
 */
export function explainDatabaseError(error: unknown, config: DatabaseConfig): string {
  if (error instanceof DatabaseSetupError) return error.message
  const where = `${config.host}:${config.port}`
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  if (typeof code === 'string' && NOT_REACHABLE.has(code)) {
    return (
      `MySQL no responde en ${where} (${code}). Comprueba que MySQL Server está instalado y en marcha ` +
      '(en Windows, el servicio «MySQL84» en Servicios o «Server Status» en MySQL Workbench) y que CUENTAS_DB_HOST y CUENTAS_DB_PORT son correctos.'
    )
  }
  if (isMysqlError(error)) {
    if (error.errno === 1045) {
      return `MySQL ha rechazado el usuario «${config.user}» en ${where}: revisa CUENTAS_DB_USER y CUENTAS_DB_PASSWORD en .env (el usuario y la contraseña que creaste en MySQL Workbench).`
    }
    if (error.errno === 1049) {
      return `La base de datos «${config.database}» no existe en MySQL (${where}). Créala en MySQL Workbench (README, «Preparar MySQL») o revisa CUENTAS_DB_NAME.`
    }
    if (error.errno === 1044) {
      return `El usuario «${config.user}» no tiene permiso sobre la base de datos «${config.database}»: dale permisos en MySQL Workbench (README, «Preparar MySQL»).`
    }
  }
  const detail = error instanceof Error ? error.message : String(error)
  return `No se puede usar la base de datos MySQL ${describeDatabase(config)}: ${detail}`
}
