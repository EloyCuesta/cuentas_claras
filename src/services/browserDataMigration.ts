import { hasUserData } from '../domain/backup.ts'
import { DB_NAME, IndexedDbFinanceRepository } from '../storage/IndexedDbFinanceRepository.ts'
import { ApiError } from './apiClient.ts'
import type { ApiFinanceRepository } from './ApiFinanceRepository.ts'

/**
 * Paso único de las versiones anteriores (datos en IndexedDB, dentro del
 * navegador) a la base de datos SQLite del servidor.
 *
 * - Solo se importa si el servidor todavía no tiene datos del usuario: nunca se
 *   mezclan ni se duplican (el servidor lo comprueba en la misma transacción).
 * - Después se vuelve a leer del servidor para comprobar que está todo.
 * - Los datos del navegador NO se borran: siguen ahí como copia.
 * - Una marca en localStorage evita repetir la comprobación en cada apertura.
 */

const FLAG_KEY = 'cuentas-claras:datos-del-navegador'

export type BrowserMigrationResult =
  | { kind: 'nothing' }
  | { kind: 'imported'; movements: number; recurring: number }
  | { kind: 'server-has-data' }

function readFlag(): string | null {
  try {
    return localStorage.getItem(FLAG_KEY)
  } catch {
    return null
  }
}

function writeFlag(value: string): void {
  try {
    localStorage.setItem(FLAG_KEY, value)
  } catch {
    // Sin localStorage se volverá a comprobar la próxima vez, sin ningún riesgo.
  }
}

/** ¿Existe la base de datos del navegador? Sin crearla si no existe. */
async function browserDatabaseExists(dbName: string): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false
  if (typeof indexedDB.databases === 'function') {
    return (await indexedDB.databases()).some((database) => database.name === dbName)
  }
  // Sin indexedDB.databases(): se abre y, si se iba a crear, se cancela.
  return new Promise((resolve) => {
    const request = indexedDB.open(dbName)
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onsuccess = () => {
      request.result.close()
      resolve(true)
    }
    request.onerror = () => resolve(false)
  })
}

export async function migrateBrowserData(
  server: Pick<ApiFinanceRepository, 'importBrowserData' | 'loadAll'>,
  { dbName = DB_NAME }: { dbName?: string } = {},
): Promise<BrowserMigrationResult> {
  if (readFlag() !== null || !(await browserDatabaseExists(dbName))) return { kind: 'nothing' }

  const browser = new IndexedDbFinanceRepository({ dbName })
  let data, lastBackupAt
  try {
    ;[data, lastBackupAt] = await Promise.all([browser.loadAll(), browser.getMeta('lastBackupAt')])
  } finally {
    await browser.close()
  }

  if (!hasUserData(data)) {
    writeFlag('sin-datos')
    return { kind: 'nothing' }
  }

  try {
    await server.importBrowserData(data, lastBackupAt)
  } catch (error) {
    if (error instanceof ApiError && error.code === 'CONFLICT') {
      writeFlag('no-importados')
      return { kind: 'server-has-data' }
    }
    throw error
  }

  // Comprobar que todo ha llegado antes de darlo por hecho.
  const saved = await server.loadAll()
  const has = (list: { id: string }[]) => new Set(list.map((item) => item.id))
  const [categories, movements, recurring] = [has(saved.categories), has(saved.movements), has(saved.recurring)]
  const complete =
    data.categories.every((c) => categories.has(c.id)) &&
    data.movements.every((m) => movements.has(m.id)) &&
    data.recurring.every((r) => recurring.has(r.id))
  if (!complete) throw new Error('No se ha podido comprobar que los datos hayan llegado completos a la base de datos.')

  writeFlag(new Date().toISOString())
  return { kind: 'imported', movements: data.movements.length, recurring: data.recurring.length }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** Aviso para el usuario según el resultado (null si no hay nada que contar). */
export function describeBrowserMigration(result: BrowserMigrationResult): { message: string; tone: 'success' | 'error' } | null {
  switch (result.kind) {
    case 'imported':
      return {
        message: `Se han pasado a la base de datos ${plural(result.movements, 'movimiento', 'movimientos')} y ${plural(result.recurring, 'recurrente', 'recurrentes')} que había en este navegador.`,
        tone: 'success',
      }
    case 'server-has-data':
      return {
        message:
          'Este navegador tenía datos guardados, pero la base de datos ya tiene otros y no se han mezclado. Siguen en el navegador; si los necesitas, restaura una copia de seguridad.',
        tone: 'error',
      }
    case 'nothing':
      return null
  }
}
