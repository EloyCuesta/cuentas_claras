import type { Migration } from './index.ts'

/** Rebuild both sides of the FK inside the migration transaction. No FK
 * disabling, no historical stock/price replay, all IDs are preserved. */
export const ticketReviewSchema: Migration = {
  version: 5,
  name: 'revisión segura y ajustes de tickets',
  up(db) {
    const schema = (name: string) => (db.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?').get('table', name) as { sql: string }).sql
    const ticketSql = schema('pantry_tickets').replace('total_cents IS NULL OR total_cents >= 0', 'total_cents IS NULL OR total_cents BETWEEN -10000000 AND 10000000')
    const lineSql = schema('pantry_ticket_lines')
    const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('pantry_tickets', 'pantry_ticket_lines') AND sql IS NOT NULL").all() as { sql: string }[]
    db.exec(`
      CREATE TEMP TABLE ticket_backup_005 AS SELECT * FROM pantry_tickets;
      CREATE TEMP TABLE line_backup_005 AS SELECT * FROM pantry_ticket_lines;
      DROP TABLE pantry_ticket_lines;
      DROP TABLE pantry_tickets;
      ${ticketSql};
      ${lineSql};
      INSERT INTO pantry_tickets SELECT * FROM ticket_backup_005;
      INSERT INTO pantry_ticket_lines SELECT * FROM line_backup_005;
      DROP TABLE line_backup_005;
      DROP TABLE ticket_backup_005;
      ALTER TABLE pantry_tickets ADD COLUMN adjustments_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE pantry_tickets ADD COLUMN issues_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE pantry_tickets ADD COLUMN import_id TEXT;
      ALTER TABLE pantry_tickets ADD COLUMN source_fingerprint TEXT;
      CREATE UNIQUE INDEX pantry_ticket_import ON pantry_tickets(import_id) WHERE import_id IS NOT NULL;
      CREATE UNIQUE INDEX pantry_ticket_source ON pantry_tickets(source_fingerprint) WHERE source_fingerprint IS NOT NULL;
      ALTER TABLE pantry_ticket_lines ADD COLUMN review_status TEXT NOT NULL DEFAULT 'verified' CHECK(review_status IN ('verified', 'pending'));
      ALTER TABLE pantry_ticket_lines ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0,1));
      ALTER TABLE pantry_ticket_lines ADD COLUMN evidence_json TEXT;
    `)
    for (const index of indexes) db.exec(index.sql)
    if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('La migración de tickets no conserva las referencias')
  },
}
