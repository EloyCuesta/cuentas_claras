import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '#shared/finance/categories.ts'
import { connectTestDatabase, createTestDatabase, dropTestDatabases, openTestDatabase, testDatabaseConfig } from '../testing/testDatabase.ts'
import { openDatabase } from './MysqlDatabase.ts'
import { LATEST_VERSION, MIGRATIONS, splitStatements } from './migrations.ts'

/** Las migraciones de MySQL (database/mysql/) contra bases de prueba de verdad. */

afterEach(async () => {
  await dropTestDatabases()
})

const APP_TABLES = [
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
]

async function tablesOf(name: string): Promise<string[]> {
  const connection = await connectTestDatabase(name)
  const [rows] = await connection.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME')
  return (rows as { name: string }[]).map((row) => row.name)
}

async function scalar(name: string, sql: string): Promise<unknown> {
  const connection = await connectTestDatabase(name)
  const [rows] = await connection.query(sql)
  return Object.values((rows as Record<string, unknown>[])[0])[0]
}

describe('migraciones de MySQL', () => {
  it('separa un archivo en sentencias sin los comentarios y exige el «;» final', () => {
    expect(splitStatements('-- comentario; con punto y coma\nCREATE TABLE a (\n  x INT\n);\n\n-- otro\nINSERT INTO a VALUES (1);\n')).toEqual([
      'CREATE TABLE a (\n  x INT\n)',
      'INSERT INTO a VALUES (1)',
    ])
    expect(() => splitStatements('CREATE TABLE a (x INT)')).toThrow(/Falta el «;» final/)
  })

  it('la primera migración es la versión 5 y los archivos publicados no cambian', () => {
    expect(MIGRATIONS.map((migration) => [migration.version, migration.name])).toEqual([[5, 'esquema inicial']])
    expect(LATEST_VERSION).toBe(5)
    // Huella del texto (con saltos de línea normalizados): un cambio va en una migración nueva.
    const folder = new URL('../../../database/mysql/', import.meta.url)
    const files = ['schema_migrations.sql', ...readdirSync(new URL('migrations/', folder)).map((file) => `migrations/${file}`)]
    const hashes = Object.fromEntries(
      files.map((file) => [file, createHash('sha256').update(readFileSync(new URL(file, folder), 'utf8').replace(/\r\n/g, '\n')).digest('hex')]),
    )
    expect(hashes).toEqual({
      'schema_migrations.sql': '3bcc3de7446105d332753e7131fadfa91827e3c5fd76d8117378196daca38d84',
      'migrations/005-esquema-inicial.sql': '7d1782a5b37cf15a2ebb34b83a34558bb6ef24616bd2b30591f0c9c326fe6af0',
    })
  })

  it('una base nueva recibe las tablas, los bloqueos, las categorías iniciales y su historial', async () => {
    const { name, schemaVersion } = await openTestDatabase(undefined, { now: () => '2026-11-03T20:00:00.000Z' })
    expect(schemaVersion).toBe(5)
    expect(await tablesOf(name)).toEqual(['app_locks', ...APP_TABLES, 'schema_migrations'].sort())
    expect(await scalar(name, 'SELECT COUNT(*) FROM categories')).toBe(DEFAULT_CATEGORIES.length)
    const connection = await connectTestDatabase(name)
    const [history] = await connection.query('SELECT * FROM schema_migrations')
    expect(history).toEqual([{ version: 5, name: 'esquema inicial', started_at: '2026-11-03T20:00:00.000Z', applied_at: '2026-11-03T20:00:00.000Z' }])
    const [locks] = await connection.query('SELECT name FROM app_locks ORDER BY name')
    expect(locks).toEqual([{ name: 'finance' }, { name: 'tickets' }])
  })

  it('al volver a abrir no repite migraciones ni toca los datos', async () => {
    const first = await openTestDatabase()
    await first.db.run("DELETE FROM categories WHERE id = 'g-ocio'")
    await first.db.run("INSERT INTO meta (`key`, value) VALUES ('lastBackupAt', 'x')")
    await first.db.close()

    const { db } = await openTestDatabase(first.name)
    const ids = (await db.rows<{ id: string }>('SELECT id FROM categories')).map((row) => row.id)
    expect(ids).not.toContain('g-ocio')
    expect(ids).toHaveLength(DEFAULT_CATEGORIES.length - 1)
    expect(await db.rows('SELECT value FROM meta')).toEqual([{ value: 'x' }])
    expect(await db.rows('SELECT version FROM schema_migrations')).toEqual([{ version: 5 }])
  })

  it('sin sembrar (lo que hace el importador) la base nueva queda sin datos', async () => {
    const { name } = await openTestDatabase(undefined, { seedNewDatabase: false })
    for (const table of APP_TABLES) expect(await scalar(name, `SELECT COUNT(*) FROM ${table}`), table).toBe(0)
    expect(await scalar(name, 'SELECT COUNT(*) FROM app_locks')).toBe(2)
  })

  it('dos procesos que abren a la vez la misma base nueva la migran una sola vez', async () => {
    const name = await createTestDatabase()
    const config = testDatabaseConfig(name)
    const opened = await Promise.all([openDatabase(config), openDatabase(config)])
    try {
      expect(opened.map((result) => result.schemaVersion)).toEqual([5, 5])
      expect(await scalar(name, 'SELECT COUNT(*) FROM categories')).toBe(DEFAULT_CATEGORIES.length)
      expect(await scalar(name, 'SELECT COUNT(*) FROM schema_migrations')).toBe(1)
    } finally {
      for (const { db } of opened) await db.close()
    }
  })

  it('se niega a abrir una base de una versión más nueva sin modificarla', async () => {
    const first = await openTestDatabase()
    await first.db.run("INSERT INTO schema_migrations (version, name, started_at, applied_at) VALUES (99, 'futura', 'x', 'x')")
    await first.db.close()
    await expect(openDatabase(testDatabaseConfig(first.name))).rejects.toThrow(/versión más nueva de Cuentas claras \(esquema 99\)/)
    expect(await scalar(first.name, 'SELECT MAX(version) FROM schema_migrations')).toBe(99)
  })

  it('una migración que falla a medias queda anotada y la siguiente apertura lo explica sin continuar', async () => {
    const name = await createTestDatabase()
    const broken = [{ version: 5, name: 'esquema inicial', file: '005-esquema-inicial.sql', statements: ['CREATE TABLE a (x INT)', 'CREATE TABLE a (x INT)'] }]
    await expect(openDatabase(testDatabaseConfig(name), { migrations: broken })).rejects.toThrow(
      /La migración 5 \(«esquema inicial»\) ha fallado en la sentencia 2 de 2: .*a medias/,
    )
    // El DDL ya confirmado se queda: la primera tabla existe y la migración no tiene applied_at.
    expect(await tablesOf(name)).toEqual(['a', 'schema_migrations'])
    await expect(openDatabase(testDatabaseConfig(name))).rejects.toThrow(/La migración 5 \(«esquema inicial»\) empezó el .* y no terminó/)
    expect(await tablesOf(name)).toEqual(['a', 'schema_migrations'])
  })

  it('no aplica el esquema sobre una base con tablas que no son de Cuentas claras', async () => {
    const name = await createTestDatabase()
    const connection = await connectTestDatabase(name)
    await connection.query('CREATE TABLE otra_app (id INT PRIMARY KEY)')
    await expect(openDatabase(testDatabaseConfig(name))).rejects.toThrow(/tiene tablas \(otra_app\) pero no el historial de Cuentas claras/)
    expect(await tablesOf(name)).toEqual(['otra_app'])
  })
})
