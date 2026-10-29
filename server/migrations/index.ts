import type { Database } from 'better-sqlite3'
import { initialSchema } from './001-esquema-inicial.ts'
import { pantrySchema } from './002-despensa.ts'
import { ticketsSchema } from './003-tickets.ts'

/**
 * Migraciones versionadas. Cada una se aplica una sola vez, dentro de una
 * transacción, y queda anotada en schema_migrations. Nunca se borran datos:
 * los cambios futuros se añaden como migraciones nuevas al final de la lista
 * (002-…, 003-…) con ALTER TABLE, tablas nuevas o copias de datos.
 */
export interface Migration {
  version: number
  name: string
  up(db: Database): void
}

export const MIGRATIONS: readonly Migration[] = [initialSchema, pantrySchema, ticketsSchema]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

/** Aplica las migraciones pendientes y devuelve la versión del esquema. */
export function runMigrations(db: Database): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((row) => row.version),
  )
  const newest = Math.max(0, ...applied)
  if (newest > LATEST_VERSION) {
    throw new Error(
      `La base de datos es de una versión más nueva de Cuentas claras (esquema ${newest}). Actualiza la aplicación antes de abrirla.`,
    )
  }

  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    db.transaction(() => {
      migration.up(db)
      record.run(migration.version, migration.name, new Date().toISOString())
    })()
  }
  return LATEST_VERSION
}
