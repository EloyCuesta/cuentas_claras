import type { Database } from 'better-sqlite3'
import type { Migration } from './index.ts'

/**
 * Repaso de la semana y «Queda poco».
 *
 * - pantry_settings.last_review_date: día del último repaso de la semana
 *   (NULL = todavía ninguno).
 * - pantry_events admite la revisión «poco» (Queda poco: a la lista sin que se
 *   haya acabado). SQLite no deja cambiar un CHECK, así que la tabla se copia
 *   entera a una nueva con la regla ampliada, sin perder ninguna fila.
 */
export const reviewSchema: Migration = {
  version: 4,
  name: 'repaso de la semana y queda poco',
  up(db: Database) {
    db.exec(`
      ALTER TABLE pantry_settings
        ADD COLUMN last_review_date TEXT CHECK (last_review_date IS NULL OR last_review_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

      CREATE TABLE pantry_events_new (
        id         TEXT PRIMARY KEY,
        item_id    TEXT NOT NULL REFERENCES pantry_items (id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('queda', 'poco', 'se_acabo', 'comprado')),
        event_date TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO pantry_events_new (id, item_id, kind, event_date, created_at)
        SELECT id, item_id, kind, event_date, created_at FROM pantry_events;
      DROP TABLE pantry_events;
      ALTER TABLE pantry_events_new RENAME TO pantry_events;
      CREATE INDEX pantry_events_item ON pantry_events (item_id);
    `)
  },
}
