import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../src/domain/categories.ts'
import { openDatabase } from './database.ts'
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
    expect(tables(db)).toEqual(['categories', 'meta', 'movements', 'recurring_excluded_dates', 'recurring_rules', 'schema_migrations'])
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
})
