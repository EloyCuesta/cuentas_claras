import type { Database } from 'better-sqlite3'
import type { Migration } from './index.ts'

/**
 * Despensa: personas, productos y presupuesto estimado del hogar.
 *
 * Son tablas aparte de las finanzas: restaurar una copia de seguridad o
 * importar los datos del navegador no las toca, y no tienen claves foráneas
 * hacia movimientos, categorías ni recurrentes.
 *
 * - owner_id NULL = Compartido. ON DELETE RESTRICT: no se puede borrar una
 *   persona que todavía tiene productos.
 * - quantity y target son cantidades con hasta 3 decimales (REAL); la app las
 *   valida y calcula en milésimas enteras.
 * - price_cents: céntimos por unidad (por kilo en «g» y por litro en «ml»).
 *   NULL = precio desconocido; 0 es un precio conocido.
 * - version aumenta en cada escritura: «Deshacer» la usa para no pisar cambios
 *   posteriores (dos escrituras en el mismo milisegundo tendrían el mismo updated_at).
 */
export const pantrySchema: Migration = {
  version: 2,
  name: 'despensa',
  up(db: Database) {
    db.exec(`
      CREATE TABLE pantry_people (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
        created_at TEXT NOT NULL
      );

      CREATE TABLE pantry_items (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
        owner_id    TEXT REFERENCES pantry_people (id) ON DELETE RESTRICT,
        unit        TEXT NOT NULL CHECK (unit IN ('ud', 'g', 'kg', 'ml', 'l', 'paquete', 'lata', 'botella', 'bolsa', 'docena')),
        quantity    REAL NOT NULL CHECK (quantity >= 0 AND quantity <= 1000000),
        target      REAL NOT NULL CHECK (target >= 0 AND target <= 1000000),
        frequency   TEXT NOT NULL CHECK (frequency IN ('semanal', 'mensual', 'ocasional')),
        price_cents INTEGER CHECK (price_cents IS NULL OR (price_cents >= 0 AND price_cents <= 10000000)),
        notes       TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 120),
        version     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX pantry_items_owner ON pantry_items (owner_id);

      -- Una sola fila (id = 1) con la configuración de la despensa.
      CREATE TABLE pantry_settings (
        id                   INTEGER PRIMARY KEY CHECK (id = 1),
        monthly_budget_cents INTEGER CHECK (monthly_budget_cents IS NULL OR (monthly_budget_cents >= 0 AND monthly_budget_cents <= 10000000))
      );
    `)
  },
}
