import type { Database } from 'better-sqlite3'
import { DEFAULT_CATEGORIES } from '../../src/domain/categories.ts'
import type { Migration } from './index.ts'

/**
 * Esquema inicial. Las tablas reflejan los tipos de src/domain/types.ts:
 * importes en céntimos enteros y fechas de calendario como texto "AAAA-MM-DD".
 *
 * - movements.recurring_id no tiene clave foránea a propósito: al eliminar un
 *   recurrente se conservan sus vencimientos ya pagados (con su id) y las copias
 *   de seguridad pueden contenerlos.
 * - El índice único (recurring_id, occurrence_date) impide que un vencimiento
 *   exista dos veces. Los movimientos normales tienen recurring_id NULL y en
 *   SQLite dos NULL nunca chocan en un índice único.
 */
export const initialSchema: Migration = {
  version: 1,
  name: 'esquema inicial',
  up(db: Database) {
    db.exec(`
      CREATE TABLE categories (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        type         TEXT NOT NULL CHECK (type IN ('ingreso', 'gasto')),
        parent_id    TEXT REFERENCES categories (id) ON DELETE CASCADE,
        order_index  REAL NOT NULL DEFAULT 0,
        budget_cents INTEGER CHECK (budget_cents IS NULL OR budget_cents >= 0)
      );
      CREATE INDEX categories_parent ON categories (parent_id);

      CREATE TABLE recurring_rules (
        id           TEXT PRIMARY KEY,
        concept      TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        type         TEXT NOT NULL CHECK (type IN ('ingreso', 'gasto')),
        category_id  TEXT NOT NULL REFERENCES categories (id),
        frequency    TEXT NOT NULL CHECK (frequency IN ('mensual', 'trimestral', 'semestral', 'anual')),
        start_date   TEXT NOT NULL,
        end_date     TEXT,
        installments INTEGER CHECK (installments IS NULL OR installments > 0),
        notes        TEXT NOT NULL DEFAULT '',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX recurring_rules_category ON recurring_rules (category_id);

      -- Vencimientos que el usuario ha eliminado y no deben volver a generarse.
      CREATE TABLE recurring_excluded_dates (
        rule_id TEXT NOT NULL REFERENCES recurring_rules (id) ON DELETE CASCADE,
        date    TEXT NOT NULL,
        PRIMARY KEY (rule_id, date)
      );

      CREATE TABLE movements (
        id                 TEXT PRIMARY KEY,
        concept            TEXT NOT NULL,
        amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),
        type               TEXT NOT NULL CHECK (type IN ('ingreso', 'gasto')),
        category_id        TEXT NOT NULL REFERENCES categories (id),
        status             TEXT NOT NULL CHECK (status IN ('pendiente', 'realizado')),
        paid_date          TEXT,
        due_date           TEXT,
        notes              TEXT NOT NULL DEFAULT '',
        recurring_id       TEXT,
        occurrence_date    TEXT,
        installment_number INTEGER,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        CHECK (status <> 'realizado' OR paid_date IS NOT NULL),
        CHECK (status <> 'pendiente' OR due_date IS NOT NULL)
      );
      CREATE INDEX movements_category ON movements (category_id);
      CREATE INDEX movements_recurring ON movements (recurring_id);
      CREATE UNIQUE INDEX movements_occurrence ON movements (recurring_id, occurrence_date);

      -- Datos auxiliares que no forman parte de la copia (fecha de la última copia…).
      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

    // Las categorías iniciales se crean una sola vez, junto con la base de datos.
    const insert = db.prepare(
      'INSERT INTO categories (id, name, type, parent_id, order_index, budget_cents) VALUES (?, ?, ?, ?, ?, ?)',
    )
    for (const c of DEFAULT_CATEGORIES) insert.run(c.id, c.name, c.type, c.parentId, c.order, c.budgetCents)
  },
}
