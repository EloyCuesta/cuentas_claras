import type { Database } from 'better-sqlite3'
import type { Migration } from './index.ts'

/**
 * Tickets de la compra y ritmo de compra de la despensa.
 *
 * - pantry_items.tracking: 'cantidad' (contar lo que hay, como hasta ahora) o
 *   'compras' (seguirlo por los tickets). Los productos que ya existían siguen
 *   en 'cantidad': nada cambia para ellos.
 * - pantry_tickets: un ticket por compra. `fingerprint` (tienda, fecha, hora y
 *   total) es único: el mismo ticket no se guarda dos veces.
 * - pantry_ticket_lines: cada línea, con el producto al que corresponde
 *   (item_id; NULL si no se sigue o si se borró el producto, que no borra el
 *   ticket). amount_cents NULL si no se pudo leer; negativo en una devolución.
 * - pantry_aliases: lo aprendido por tienda («LECHE SEMI HACEND 1L» en Lidl
 *   es la Leche). item_id NULL e ignored = 1: esa línea no se sigue.
 * - pantry_events: «Queda», «Se acabó» y «Lo he comprado» (sin ticket).
 */
export const ticketsSchema: Migration = {
  version: 3,
  name: 'tickets y ritmo de compra',
  up(db: Database) {
    db.exec(`
      ALTER TABLE pantry_items
        ADD COLUMN tracking TEXT NOT NULL DEFAULT 'cantidad' CHECK (tracking IN ('cantidad', 'compras'));

      CREATE TABLE pantry_tickets (
        id            TEXT PRIMARY KEY,
        store         TEXT NOT NULL CHECK (store IN ('lidl', 'otra')),
        store_name    TEXT NOT NULL CHECK (length(trim(store_name)) BETWEEN 1 AND 60),
        address       TEXT NOT NULL DEFAULT '' CHECK (length(address) <= 120),
        purchase_date TEXT NOT NULL,
        purchase_time TEXT,
        total_cents   INTEGER CHECK (total_cents IS NULL OR total_cents >= 0),
        fingerprint   TEXT NOT NULL UNIQUE,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX pantry_tickets_date ON pantry_tickets (purchase_date);

      CREATE TABLE pantry_ticket_lines (
        id                 TEXT PRIMARY KEY,
        ticket_id          TEXT NOT NULL REFERENCES pantry_tickets (id) ON DELETE CASCADE,
        position           INTEGER NOT NULL CHECK (position >= 0),
        raw_name           TEXT NOT NULL CHECK (length(raw_name) BETWEEN 1 AND 80),
        name_key           TEXT NOT NULL,
        quantity           INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999),
        unit_price_cents   INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents >= 0),
        amount_cents       INTEGER,
        discount_cents     INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
        weight_kg          REAL CHECK (weight_kg IS NULL OR (weight_kg > 0 AND weight_kg <= 1000)),
        price_per_kg_cents INTEGER CHECK (price_per_kg_cents IS NULL OR price_per_kg_cents >= 0),
        tax_code           TEXT CHECK (tax_code IS NULL OR tax_code IN ('A', 'B', 'C')),
        item_id            TEXT REFERENCES pantry_items (id) ON DELETE SET NULL,
        occasional         INTEGER NOT NULL DEFAULT 0 CHECK (occasional IN (0, 1)),
        UNIQUE (ticket_id, position)
      );
      CREATE INDEX pantry_ticket_lines_item ON pantry_ticket_lines (item_id);

      CREATE TABLE pantry_aliases (
        store      TEXT NOT NULL,
        name_key   TEXT NOT NULL,
        item_id    TEXT REFERENCES pantry_items (id) ON DELETE CASCADE,
        ignored    INTEGER NOT NULL DEFAULT 0 CHECK (ignored IN (0, 1)),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (store, name_key),
        CHECK ((item_id IS NULL) = (ignored = 1))
      );
      CREATE INDEX pantry_aliases_item ON pantry_aliases (item_id);

      CREATE TABLE pantry_events (
        id         TEXT PRIMARY KEY,
        item_id    TEXT NOT NULL REFERENCES pantry_items (id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('queda', 'se_acabo', 'comprado')),
        event_date TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX pantry_events_item ON pantry_events (item_id);
    `)
  },
}
