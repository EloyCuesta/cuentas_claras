import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { runMigrations } from './index.ts'

/**
 * Abrir una base SQLite de Cuentas claras, la de antes de MySQL. El servidor
 * ya no la usa: solo la leen el importador (tools/importer/) y sus pruebas.
 */

export interface OpenedSqlite {
  db: Database.Database
  schemaVersion: number
}

/**
 * Crea (o abre) una base SQLite y le aplica las migraciones 001–005, como
 * hacía el servidor: claves foráneas activas y WAL. Para preparar copias
 * sintéticas en las pruebas; nunca se usa con los datos de nadie.
 */
export function createSqlite(path: string): OpenedSqlite {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    return { db, schemaVersion: runMigrations(db) }
  } catch (error) {
    db.close()
    throw error
  }
}

/**
 * Abre una copia de cuentas.db en solo lectura: si no existe no la crea, y no
 * se puede escribir en ella (ni aplicar migraciones).
 */
export function openSqliteReadOnly(path: string): Database.Database {
  return new Database(path, { readonly: true, fileMustExist: true })
}
