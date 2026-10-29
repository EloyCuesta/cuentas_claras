import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../src/domain/categories.ts'
import { openDatabase } from './database.ts'
import { initialSchema } from './migrations/001-esquema-inicial.ts'
import { pantrySchema } from './migrations/002-despensa.ts'
import { ticketsSchema } from './migrations/003-tickets.ts'
import { LATEST_VERSION } from './migrations/index.ts'
import { removeTempDbs, tempDbPath } from './test-helpers.ts'

const opened: Database.Database[] = []

function open(path: string) {
  const result = openDatabase(path)
  opened.push(result.db)
  return result
}

afterEach(() => {
  for (const db of opened.splice(0)) if (db.open) db.close()
  removeTempDbs()
})

const tables = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name)

describe('openDatabase', () => {
  it('crea el archivo, las tablas y las categorías iniciales si no existe', () => {
    const path = tempDbPath()
    expect(existsSync(path)).toBe(false)
    const { db, schemaVersion } = open(path)
    expect(existsSync(path)).toBe(true)
    expect(schemaVersion).toBe(LATEST_VERSION)
    expect(tables(db)).toEqual([
      'categories',
      'meta',
      'movements',
      'pantry_aliases',
      'pantry_events',
      'pantry_items',
      'pantry_people',
      'pantry_settings',
      'pantry_ticket_lines',
      'pantry_tickets',
      'recurring_excluded_dates',
      'recurring_rules',
      'schema_migrations',
    ])
    expect((db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n).toBe(DEFAULT_CATEGORIES.length)
  })

  it('activa WAL y las claves foráneas', () => {
    const { db } = open(tempDbPath())
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('al volver a abrir no repite migraciones ni toca los datos', () => {
    const path = tempDbPath()
    const first = open(path).db
    first.prepare("DELETE FROM categories WHERE id = 'g-ocio'").run()
    first.prepare("INSERT INTO meta (key, value) VALUES ('lastBackupAt', 'x')").run()
    first.close()

    const { db } = open(path)
    const ids = (db.prepare('SELECT id FROM categories').all() as { id: string }[]).map((c) => c.id)
    expect(ids).not.toContain('g-ocio')
    expect(ids).toHaveLength(DEFAULT_CATEGORIES.length - 1)
    expect(db.prepare('SELECT value FROM meta').pluck().get()).toBe('x')
    expect(db.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get()).toBe(LATEST_VERSION)
  })

  it('se niega a abrir una base de datos de una versión más nueva sin modificarla', () => {
    const path = tempDbPath()
    const first = open(path).db
    first.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (99, 'futura', 'x')").run()
    first.close()
    expect(() => openDatabase(path)).toThrow(/versión más nueva/)

    const check = new Database(path)
    opened.push(check)
    expect(check.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get()).toBe(99)
  })

  it('las restricciones de la base de datos protegen los datos', () => {
    const { db } = open(tempDbPath())
    const insert = db.prepare(
      `INSERT INTO movements (id, concept, amount_cents, type, category_id, status, paid_date, due_date, notes, created_at, updated_at)
       VALUES (?, 'x', ?, 'gasto', ?, 'realizado', '2026-10-01', NULL, '', 'x', 'x')`,
    )
    expect(() => insert.run('a', 0, 'g-ocio')).toThrow(/CHECK/) // importe en céntimos > 0
    expect(() => insert.run('b', 100, 'no-existe')).toThrow(/FOREIGN KEY/)
    insert.run('c', 100, 'g-ocio')
    expect(() => db.prepare("DELETE FROM categories WHERE id = 'g-ocio'").run()).toThrow(/FOREIGN KEY/)
  })

  it('pasa una base de datos de la versión 1 con datos a la última sin tocar las finanzas', () => {
    const path = tempDbPath()
    // Una base de datos como la dejaba la versión anterior (solo la migración 1).
    const old = new Database(path)
    old.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
    initialSchema.up(old)
    old.prepare("INSERT INTO schema_migrations VALUES (1, 'esquema inicial', 'x')").run()
    old
      .prepare(
        `INSERT INTO movements (id, concept, amount_cents, type, category_id, status, paid_date, due_date, notes, created_at, updated_at)
         VALUES ('m1', 'Mercadona', 5430, 'gasto', 'g-alimentacion', 'realizado', '2026-10-01', NULL, '', 'x', 'x')`,
      )
      .run()
    old.prepare("INSERT INTO meta (key, value) VALUES ('lastBackupAt', 'y')").run()
    old.close()

    const { db, schemaVersion } = open(path)
    expect(schemaVersion).toBe(LATEST_VERSION)
    expect(tables(db)).toEqual(expect.arrayContaining(['pantry_items', 'pantry_people', 'pantry_settings', 'pantry_tickets']))
    expect(db.prepare('SELECT concept FROM movements').pluck().all()).toEqual(['Mercadona'])
    expect(db.prepare('SELECT value FROM meta').pluck().get()).toBe('y')
    expect(db.prepare('SELECT COUNT(*) FROM categories').pluck().get()).toBe(DEFAULT_CATEGORIES.length)
    expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all()).toEqual([1, 2, 3, 4])

    // Al volver a abrir no se repite ni se borra nada.
    db.prepare("INSERT INTO pantry_people (id, name, created_at) VALUES ('p1', 'Eloy', 'x')").run()
    db.close()
    const again = open(path).db
    expect(again.prepare('SELECT name FROM pantry_people').pluck().all()).toEqual(['Eloy'])
    expect(again.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get()).toBe(LATEST_VERSION)
  })

  it('la versión 3 añade los tickets sin cambiar los productos que ya había (siguen contándose)', () => {
    const path = tempDbPath()
    const old = new Database(path)
    old.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
    initialSchema.up(old)
    pantrySchema.up(old)
    old.prepare("INSERT INTO schema_migrations VALUES (1, 'esquema inicial', 'x'), (2, 'despensa', 'x')").run()
    old
      .prepare(
        `INSERT INTO pantry_items (id, name, owner_id, unit, quantity, target, frequency, price_cents, notes, created_at, updated_at)
         VALUES ('i1', 'Leche', NULL, 'l', 2, 6, 'semanal', 95, '', 'x', 'x')`,
      )
      .run()
    old.close()

    const { db } = open(path)
    expect(db.prepare('SELECT name, tracking, quantity, target, version FROM pantry_items').get()).toEqual({
      name: 'Leche',
      tracking: 'cantidad',
      quantity: 2,
      target: 6,
      version: 1,
    })
    expect(() => db.prepare("UPDATE pantry_items SET tracking = 'otro'").run()).toThrow(/CHECK/)
  })

  it('la versión 4 conserva las revisiones, admite «Queda poco» y guarda el día del repaso', () => {
    const path = tempDbPath()
    const old = new Database(path)
    old.pragma('foreign_keys = ON')
    old.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
    initialSchema.up(old)
    pantrySchema.up(old)
    ticketsSchema.up(old)
    old.prepare("INSERT INTO schema_migrations VALUES (1, 'esquema inicial', 'x'), (2, 'despensa', 'x'), (3, 'tickets', 'x')").run()
    old
      .prepare(
        `INSERT INTO pantry_items (id, name, owner_id, unit, tracking, quantity, target, frequency, price_cents, notes, created_at, updated_at)
         VALUES ('i1', 'Leche', NULL, 'ud', 'compras', 0, 0, 'semanal', NULL, '', 'x', 'x')`,
      )
      .run()
    old.prepare("INSERT INTO pantry_events (id, item_id, kind, event_date, created_at) VALUES ('e1', 'i1', 'se_acabo', '2026-10-25', 'y')").run()
    old.prepare('INSERT INTO pantry_settings (id, monthly_budget_cents) VALUES (1, 30000)').run()
    expect(() => old.prepare("INSERT INTO pantry_events (id, item_id, kind, event_date, created_at) VALUES ('e0', 'i1', 'poco', '2026-10-25', 'y')").run()).toThrow(
      /CHECK/,
    )
    old.close()

    const { db } = open(path)
    expect(db.prepare('SELECT id, item_id, kind, event_date, created_at FROM pantry_events').all()).toEqual([
      { id: 'e1', item_id: 'i1', kind: 'se_acabo', event_date: '2026-10-25', created_at: 'y' },
    ])
    expect(db.prepare('SELECT monthly_budget_cents, last_review_date FROM pantry_settings').get()).toEqual({
      monthly_budget_cents: 30000,
      last_review_date: null,
    })
    const event = db.prepare("INSERT INTO pantry_events (id, item_id, kind, event_date, created_at) VALUES (?, 'i1', ?, '2026-10-26', 'z')")
    event.run('e2', 'poco')
    expect(() => event.run('e3', 'mucho')).toThrow(/CHECK/)
    expect(() => db.prepare("INSERT INTO pantry_events (id, item_id, kind, event_date, created_at) VALUES ('e4', 'no-existe', 'queda', 'x', 'x')").run()).toThrow(
      /FOREIGN KEY/,
    )
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pantry_events'").pluck().all()).toContain('pantry_events_item')
    expect(() => db.prepare("UPDATE pantry_settings SET last_review_date = 'ayer'").run()).toThrow(/CHECK/)
    db.prepare("UPDATE pantry_settings SET last_review_date = '2026-10-29'").run()
    // Las revisiones se siguen borrando con su producto.
    db.prepare("DELETE FROM pantry_items WHERE id = 'i1'").run()
    expect(db.prepare('SELECT COUNT(*) FROM pantry_events').pluck().get()).toBe(0)
  })

  it('las restricciones de los tickets protegen los datos', () => {
    const { db } = open(tempDbPath())
    db.prepare(
      `INSERT INTO pantry_items (id, name, owner_id, unit, tracking, quantity, target, frequency, price_cents, notes, created_at, updated_at)
       VALUES ('i1', 'Leche', NULL, 'ud', 'compras', 0, 0, 'semanal', NULL, '', 'x', 'x')`,
    ).run()
    const ticket = db.prepare(
      `INSERT INTO pantry_tickets (id, store, store_name, address, purchase_date, purchase_time, total_cents, fingerprint, created_at)
       VALUES (?, 'lidl', 'Lidl', '', '2026-10-24', NULL, 100, ?, 'x')`,
    )
    ticket.run('t1', 'huella')
    expect(() => ticket.run('t2', 'huella')).toThrow(/UNIQUE/)
    const line = db.prepare(
      `INSERT INTO pantry_ticket_lines (id, ticket_id, position, raw_name, name_key, quantity, amount_cents, item_id)
       VALUES (?, 't1', ?, 'LECHE', 'LECHE', ?, 100, ?)`,
    )
    line.run('l1', 0, 1, 'i1')
    expect(() => line.run('l2', 0, 1, 'i1')).toThrow(/UNIQUE/)
    expect(() => line.run('l3', 1, 0, 'i1')).toThrow(/CHECK/)
    expect(() => line.run('l4', 2, 1, 'no-existe')).toThrow(/FOREIGN KEY/)
    const alias = db.prepare('INSERT INTO pantry_aliases (store, name_key, item_id, ignored, updated_at) VALUES (?, ?, ?, ?, ?)')
    expect(() => alias.run('lidl', 'X', null, 0, 'x')).toThrow(/CHECK/)
    alias.run('lidl', 'LECHE', 'i1', 0, 'x')
    db.prepare("INSERT INTO pantry_events (id, item_id, kind, event_date, created_at) VALUES ('e1', 'i1', 'queda', '2026-10-25', 'x')").run()
    // Borrar el producto: la línea se queda sin producto; lo aprendido y las revisiones se van con él.
    db.prepare("DELETE FROM pantry_items WHERE id = 'i1'").run()
    expect(db.prepare("SELECT item_id FROM pantry_ticket_lines WHERE id = 'l1'").pluck().get()).toBeNull()
    expect(db.prepare('SELECT COUNT(*) FROM pantry_aliases').pluck().get()).toBe(0)
    expect(db.prepare('SELECT COUNT(*) FROM pantry_events').pluck().get()).toBe(0)
    // Borrar el ticket borra sus líneas.
    db.prepare("DELETE FROM pantry_tickets WHERE id = 't1'").run()
    expect(db.prepare('SELECT COUNT(*) FROM pantry_ticket_lines').pluck().get()).toBe(0)
  })

  it('las restricciones de la despensa protegen los datos', () => {
    const { db } = open(tempDbPath())
    db.prepare("INSERT INTO pantry_people (id, name, created_at) VALUES ('p1', 'Eloy', 'x')").run()
    const insert = db.prepare(
      `INSERT INTO pantry_items (id, name, owner_id, unit, quantity, target, frequency, price_cents, notes, created_at, updated_at)
       VALUES (@id, @name, @owner, @unit, @quantity, 1, @frequency, @price, '', 'x', 'x')`,
    )
    const ok = { id: 'i1', name: 'Leche', owner: 'p1', unit: 'l', quantity: 1, frequency: 'semanal', price: null }
    expect(() => insert.run({ ...ok, id: 'a', unit: 'barril' })).toThrow(/CHECK/)
    expect(() => insert.run({ ...ok, id: 'b', frequency: 'diaria' })).toThrow(/CHECK/)
    expect(() => insert.run({ ...ok, id: 'c', quantity: -1 })).toThrow(/CHECK/)
    expect(() => insert.run({ ...ok, id: 'd', price: -1 })).toThrow(/CHECK/)
    expect(() => insert.run({ ...ok, id: 'e', name: '   ' })).toThrow(/CHECK/)
    expect(() => insert.run({ ...ok, id: 'f', owner: 'no-existe' })).toThrow(/FOREIGN KEY/)
    insert.run(ok)
    expect(db.prepare("SELECT version FROM pantry_items WHERE id = 'i1'").pluck().get()).toBe(1)
    // Borrado restringido: una persona con productos no se puede borrar.
    expect(() => db.prepare("DELETE FROM pantry_people WHERE id = 'p1'").run()).toThrow(/FOREIGN KEY/)
    expect(() => db.prepare('INSERT INTO pantry_settings (id, monthly_budget_cents) VALUES (2, 0)').run()).toThrow(/CHECK/)
  })
})
