/**
 * Configuración de la conexión a MySQL, leída de las variables de entorno
 * CUENTAS_DB_*. Nunca guarda ni muestra la contraseña: describeDatabase da lo
 * que se puede escribir en la consola.
 */

export interface DatabaseConfig {
  host: string
  port: number
  user: string
  password: string
  /** Nombre de la base de datos (debe existir: la aplicación no la crea). */
  database: string
}

export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 3306
export const DEFAULT_DATABASE = 'cuentas_claras'
/** La base de las pruebas en navegador (playwright.config.ts). */
export const E2E_DATABASE = 'cuentas_claras_e2e'
/** Prefijo de las bases temporales de Vitest (server/common/testing/testDatabase.ts). */
export const TEST_DATABASE_PREFIX = 'cuentas_test_'

const DATABASE_NAME = /^[A-Za-z0-9_]{1,64}$/

export type DatabaseConfigResult = { ok: true; config: DatabaseConfig } | { ok: false; message: string }

/** Lee CUENTAS_DB_HOST, CUENTAS_DB_PORT, CUENTAS_DB_USER, CUENTAS_DB_PASSWORD y CUENTAS_DB_NAME. */
export function readDatabaseConfig(env: Record<string, string | undefined>): DatabaseConfigResult {
  const text = (name: string) => env[name]?.trim() || undefined
  const host = text('CUENTAS_DB_HOST') ?? DEFAULT_HOST

  const portText = text('CUENTAS_DB_PORT')
  const port = portText === undefined ? DEFAULT_PORT : Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, message: `CUENTAS_DB_PORT debe ser un número de puerto entre 1 y 65535 (por defecto ${DEFAULT_PORT}).` }
  }

  const user = text('CUENTAS_DB_USER')
  if (!user) {
    return {
      ok: false,
      message: 'Falta CUENTAS_DB_USER: el usuario de MySQL con el que se conecta la aplicación. Escríbelo en .env junto con CUENTAS_DB_PASSWORD (README, «Preparar MySQL»).',
    }
  }

  const database = text('CUENTAS_DB_NAME') ?? DEFAULT_DATABASE
  if (!DATABASE_NAME.test(database)) {
    return { ok: false, message: 'CUENTAS_DB_NAME solo puede tener letras sin tildes, números y guiones bajos (hasta 64).' }
  }

  // La contraseña no se recorta: puede empezar o terminar con espacios.
  return { ok: true, config: { host, port, user, password: env.CUENTAS_DB_PASSWORD ?? '', database } }
}

/** Con CUENTAS_TEST=1 solo valen la base de las e2e o una temporal de Vitest: nunca la de uso diario. */
export function isTestDatabaseName(name: string): boolean {
  return name === E2E_DATABASE || /^cuentas_test_[a-z0-9_]+$/.test(name)
}

/** «usuario@equipo:puerto/base», sin la contraseña. */
export function describeDatabase(config: DatabaseConfig): string {
  return `${config.user}@${config.host}:${config.port}/${config.database}`
}
