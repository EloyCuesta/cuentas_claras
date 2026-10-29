import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runMigrations } from '../../migrations/index.ts'

/** Archivo de la base de datos si no se indica otro con CUENTAS_DB_PATH. */
export const DEFAULT_DB_PATH = fileURLToPath(new URL('../../data/cuentas.db', import.meta.url))

export interface OpenedDatabase {
  db: Database.Database
  path: string
  schemaVersion: number
}

/**
 * Abre (o crea) la base de datos SQLite y la deja lista: crea la carpeta si
 * falta, activa WAL y las claves foráneas y aplica las migraciones pendientes.
 * Nunca borra ni sobrescribe datos existentes.
 */
export function openDatabase(path: string = DEFAULT_DB_PATH): OpenedDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  try {
    // WAL: las lecturas no esperan a las escrituras y un corte no deja la base a medias.
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    // Si otro proceso está escribiendo, espera hasta 5 s en lugar de fallar.
    db.pragma('busy_timeout = 5000')
    const schemaVersion = runMigrations(db)
    return { db, path, schemaVersion }
  } catch (error) {
    db.close()
    throw error
  }
}
