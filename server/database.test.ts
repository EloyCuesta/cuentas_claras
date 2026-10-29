import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../src/domain/categories.ts'
import { openDatabase } from './database.ts'
import { initialSchema } from './migrations/001-esquema-inicial.ts'
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
      'pantry_items',
      'pantry_people',
      'pantry_settings',
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

  it('pasa una base de datos de la versión 1 con datos a la 2 sin tocar las finanzas', () => {
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
    expect(schemaVersion).toBe(2)
    expect(tables(db)).toEqual(expect.arrayContaining(['pantry_items', 'pantry_people', 'pantry_settings']))
    expect(db.prepare('SELECT concept FROM movements').pluck().all()).toEqual(['Mercadona'])
    expect(db.prepare('SELECT value FROM meta').pluck().get()).toBe('y')
    expect(db.prepare('SELECT COUNT(*) FROM categories').pluck().get()).toBe(DEFAULT_CATEGORIES.length)
    expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all()).toEqual([1, 2])

    // Al volver a abrir no se repite ni se borra nada.
    db.prepare("INSERT INTO pantry_people (id, name, created_at) VALUES ('p1', 'Eloy', 'x')").run()
    db.close()
    const again = open(path).db
    expect(again.prepare('SELECT name FROM pantry_people').pluck().all()).toEqual(['Eloy'])
    expect(again.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get()).toBe(2)
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
