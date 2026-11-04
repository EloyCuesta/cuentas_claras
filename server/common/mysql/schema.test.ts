import { afterEach, describe, expect, it } from 'vitest'
import { MAX_CENTS } from '#shared/common/money.ts'
import { dropTestDatabases, openTestDatabase } from '../testing/testDatabase.ts'
import type { MysqlDatabase, SqlParam } from './MysqlDatabase.ts'

/**
 * El esquema de MySQL protege los datos como el de SQLite: tipos, restricciones,
 * acciones de las claves foráneas, colaciones y precisión. Sustituye a las
 * pruebas de restricciones de SQLite (tools/sqlite/migrations.test.ts conserva
 * las de sus migraciones). Las tablas se nombran solo con constantes del test.
 */

afterEach(async () => {
  await dropTestDatabases()
})

const MOVEMENT = { concept: 'x', amount_cents: 100, type: 'gasto', category_id: 'g-ocio', status: 'realizado', paid_date: '2026-10-01', notes: '', created_at: 'x', updated_at: 'x' }
const ITEM = { name: 'Leche', owner_id: null, unit: 'ud', tracking: 'compras', quantity: 0, target: 0, frequency: 'semanal', price_cents: null, notes: '', created_at: 'x', updated_at: 'x' }
const TICKET = { store: 'lidl', store_name: 'Lidl', address: '', purchase_date: '2026-10-24', purchase_time: null, total_cents: 100, created_at: 'x' }
const LINE = { ticket_id: 't1', raw_name: 'LECHE', name_key: 'LECHE', quantity: 1, amount_cents: 100, item_id: 'i1' }

function inserter(db: MysqlDatabase) {
  return (table: string, row: Record<string, SqlParam>) => {
    const columns = Object.keys(row)
    return db.run(
      `INSERT INTO ${table} (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      Object.values(row),
    )
  }
}

/** Lo que mysql2 da en un error de MySQL. */
const mysqlError = (errno: number) => expect.objectContaining({ errno })

describe('esquema de MySQL', () => {
  it('todas las tablas son InnoDB con utf8mb4_0900_bin, también cada columna de texto', async () => {
    const { db } = await openTestDatabase()
    const tables = await db.rows<{ name: string; engine: string; collation: string }>(
      'SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
    )
    expect(tables).toHaveLength(14)
    for (const table of tables) expect([table.name, table.engine, table.collation]).toEqual([table.name, 'InnoDB', 'utf8mb4_0900_bin'])
    const columns = await db.rows<{ name: string; collation: string; charset: string }>(
      `SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME) AS name, COLLATION_NAME AS collation, CHARACTER_SET_NAME AS charset
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLLATION_NAME IS NOT NULL`,
    )
    expect(columns.length).toBeGreaterThan(50)
    for (const column of columns) expect([column.name, column.charset, column.collation]).toEqual([column.name, 'utf8mb4', 'utf8mb4_0900_bin'])
    // Las claves foráneas están activas en la sesión de la aplicación.
    expect(await db.rows('SELECT @@foreign_key_checks AS fk')).toEqual([{ fk: 1 }])
  })

  it('las doce tablas de la aplicación tienen las columnas del esquema final de SQLite, en su orden', async () => {
    const { db } = await openTestDatabase()
    const rows = await db.rows<{ table_name: string; columns: string }>(
      `SELECT TABLE_NAME AS table_name, GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ', ') AS columns
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() GROUP BY TABLE_NAME ORDER BY TABLE_NAME`,
    )
    expect(Object.fromEntries(rows.map((row) => [row.table_name, row.columns]))).toEqual({
      app_locks: 'name',
      categories: 'id, name, type, parent_id, order_index, budget_cents',
      meta: 'key, value',
      movements:
        'id, concept, amount_cents, type, category_id, status, paid_date, due_date, notes, recurring_id, occurrence_date, installment_number, created_at, updated_at',
      pantry_aliases: 'store, name_key, item_id, ignored, updated_at',
      pantry_events: 'id, item_id, kind, event_date, created_at',
      pantry_items: 'id, name, owner_id, unit, quantity, target, frequency, price_cents, notes, version, created_at, updated_at, tracking',
      pantry_people: 'id, name, created_at',
      pantry_settings: 'id, monthly_budget_cents, last_review_date',
      pantry_ticket_lines:
        'id, ticket_id, position, raw_name, name_key, quantity, unit_price_cents, amount_cents, discount_cents, weight_kg, price_per_kg_cents, tax_code, item_id, occasional, review_status, confirmed, evidence_json',
      pantry_tickets:
        'id, store, store_name, address, purchase_date, purchase_time, total_cents, fingerprint, created_at, adjustments_json, issues_json, import_id, source_fingerprint',
      recurring_excluded_dates: 'rule_id, date',
      recurring_rules: 'id, concept, amount_cents, type, category_id, frequency, start_date, end_date, installments, notes, created_at, updated_at',
      schema_migrations: 'version, name, started_at, applied_at',
    })
  })

  it('las restricciones de las finanzas protegen los datos', async () => {
    const { db } = await openTestDatabase()
    const insert = inserter(db)
    await expect(insert('movements', { ...MOVEMENT, id: 'a', amount_cents: 0 })).rejects.toEqual(mysqlError(3819)) // céntimos > 0
    await expect(insert('movements', { ...MOVEMENT, id: 'b', category_id: 'no-existe' })).rejects.toEqual(mysqlError(1452))
    await expect(insert('movements', { ...MOVEMENT, id: 'r', status: 'realizado', paid_date: null })).rejects.toEqual(mysqlError(3819))
    await expect(insert('movements', { ...MOVEMENT, id: 'p', status: 'pendiente', due_date: null })).rejects.toEqual(mysqlError(3819))
    await insert('movements', { ...MOVEMENT, id: 'c' })
    await expect(db.run("DELETE FROM categories WHERE id = 'g-ocio'")).rejects.toEqual(mysqlError(1451))
    // Un vencimiento no existe dos veces; varios movimientos sin recurrente no chocan.
    const occurrence = { ...MOVEMENT, recurring_id: 'r1', occurrence_date: '2026-11-01' }
    await insert('movements', { ...occurrence, id: 'o1' })
    await expect(insert('movements', { ...occurrence, id: 'o2' })).rejects.toEqual(mysqlError(1062))
    await insert('movements', { ...MOVEMENT, id: 'd' })
    // Borrar una categoría principal borra sus subcategorías; un recurrente arrastra sus fechas excluidas.
    await db.run("DELETE FROM categories WHERE id = 'g-vivienda'")
    expect(await db.rows("SELECT id FROM categories WHERE id LIKE 'g-vivienda%'")).toEqual([])
    await insert('recurring_rules', { id: 'r1', concept: 'x', amount_cents: 1, type: 'gasto', category_id: 'g-otros', frequency: 'mensual', start_date: '2026-10-01', created_at: 'x', updated_at: 'x' })
    await insert('recurring_excluded_dates', { rule_id: 'r1', date: '2026-12-01' })
    await expect(insert('recurring_excluded_dates', { rule_id: 'no-existe', date: '2026-12-01' })).rejects.toEqual(mysqlError(1452))
    await db.run("DELETE FROM recurring_rules WHERE id = 'r1'")
    expect(await db.rows('SELECT * FROM recurring_excluded_dates')).toEqual([])
    // recurring_id no es clave foránea: el vencimiento se queda aunque su recurrente ya no exista.
    expect(await db.rows("SELECT id FROM movements WHERE recurring_id = 'r1'")).toEqual([{ id: 'o1' }])
  })

  it('las restricciones de la despensa protegen los datos', async () => {
    const { db } = await openTestDatabase()
    const insert = inserter(db)
    await insert('pantry_people', { id: 'p1', name: 'Eloy', created_at: 'x' })
    const ok = { ...ITEM, owner_id: 'p1', unit: 'l', quantity: 1, target: 1 }
    await expect(insert('pantry_items', { ...ok, id: 'a', unit: 'barril' })).rejects.toEqual(mysqlError(3819))
    await expect(insert('pantry_items', { ...ok, id: 'b', frequency: 'diaria' })).rejects.toEqual(mysqlError(3819))
    await expect(insert('pantry_items', { ...ok, id: 'c', quantity: -1 })).rejects.toEqual(mysqlError(3819))
    await expect(insert('pantry_items', { ...ok, id: 'c2', target: 1000000.001 })).rejects.toEqual(mysqlError(3819))
    await expect(insert('pantry_items', { ...ok, id: 'd', price_cents: -1 })).rejects.toEqual(mysqlError(3819))
    await expect(insert('pantry_items', { ...ok, id: 'e', name: '   ' })).rejects.toEqual(mysqlError(3819))
    await expect(insert('pantry_items', { ...ok, id: 'f', owner_id: 'no-existe' })).rejects.toEqual(mysqlError(1452))
    await expect(insert('pantry_items', { ...ok, id: 'g', tracking: 'otro' })).rejects.toEqual(mysqlError(3819))
    await expect(insert('pantry_people', { id: 'p2', name: ' ', created_at: 'x' })).rejects.toEqual(mysqlError(3819))
    await insert('pantry_items', { ...ok, id: 'i1' })
    expect(await db.rows("SELECT version FROM pantry_items WHERE id = 'i1'")).toEqual([{ version: 1 }])
    // Borrado restringido: una persona con productos no se puede borrar.
    await expect(db.run("DELETE FROM pantry_people WHERE id = 'p1'")).rejects.toEqual(mysqlError(1451))
    await expect(insert('pantry_settings', { id: 2, monthly_budget_cents: 0 })).rejects.toEqual(mysqlError(3819))
    await insert('pantry_settings', { id: 1, monthly_budget_cents: 30000 })
    // last_review_date es DATE: una fecha que no es fecha (antes, el GLOB de SQLite) se rechaza.
    await expect(db.run("UPDATE pantry_settings SET last_review_date = 'ayer'")).rejects.toEqual(mysqlError(1292))
    await db.run("UPDATE pantry_settings SET last_review_date = '2026-10-29'")
    // Las revisiones: «poco» vale, otra cosa no; se borran con su producto.
    await insert('pantry_events', { id: 'e1', item_id: 'i1', kind: 'poco', event_date: '2026-10-26', created_at: 'z' })
    await expect(insert('pantry_events', { id: 'e2', item_id: 'i1', kind: 'mucho', event_date: '2026-10-26', created_at: 'z' })).rejects.toEqual(mysqlError(3819))
    await expect(insert('pantry_events', { id: 'e3', item_id: 'no-existe', kind: 'queda', event_date: '2026-10-26', created_at: 'z' })).rejects.toEqual(mysqlError(1452))
    await db.run("DELETE FROM pantry_items WHERE id = 'i1'")
    expect(await db.rows('SELECT COUNT(*) AS n FROM pantry_events')).toEqual([{ n: 0 }])
  })

  it('las restricciones de los tickets protegen los datos y sus claves foráneas hacen lo de SQLite', async () => {
    const { db } = await openTestDatabase()
    const insert = inserter(db)
    await insert('pantry_items', { ...ITEM, id: 'i1' })
    await insert('pantry_tickets', { ...TICKET, id: 't1', fingerprint: 'huella' })
    await expect(insert('pantry_tickets', { ...TICKET, id: 't2', fingerprint: 'huella' })).rejects.toEqual(mysqlError(1062))
    await expect(insert('pantry_tickets', { ...TICKET, id: 't3', fingerprint: 'h3', total_cents: 10000001 })).rejects.toEqual(mysqlError(3819))
    await insert('pantry_tickets', { ...TICKET, id: 't4', fingerprint: 'h4', total_cents: -10000000 })
    await insert('pantry_ticket_lines', { ...LINE, id: 'l1', position: 0 })
    await expect(insert('pantry_ticket_lines', { ...LINE, id: 'l2', position: 0 })).rejects.toEqual(mysqlError(1062))
    await expect(insert('pantry_ticket_lines', { ...LINE, id: 'l3', position: 1, quantity: 0 })).rejects.toEqual(mysqlError(3819))
    await expect(insert('pantry_ticket_lines', { ...LINE, id: 'l4', position: 2, item_id: 'no-existe' })).rejects.toEqual(mysqlError(1452))
    await expect(insert('pantry_ticket_lines', { ...LINE, id: 'l5', position: 3, tax_code: 'D' })).rejects.toEqual(mysqlError(3819))
    await expect(insert('pantry_ticket_lines', { ...LINE, id: 'l6', position: 4, review_status: 'dudosa' })).rejects.toEqual(mysqlError(3819))
    await expect(insert('pantry_aliases', { store: 'lidl', name_key: 'X', item_id: null, ignored: 0, updated_at: 'x' })).rejects.toEqual(mysqlError(3819))
    await expect(insert('pantry_aliases', { store: 'lidl', name_key: 'Y', item_id: 'i1', ignored: 1, updated_at: 'x' })).rejects.toEqual(mysqlError(3819))
    await insert('pantry_aliases', { store: 'lidl', name_key: 'LECHE', item_id: 'i1', ignored: 0, updated_at: 'x' })
    await insert('pantry_aliases', { store: 'lidl', name_key: 'BOLSA', item_id: null, ignored: 1, updated_at: 'x' })
    await insert('pantry_events', { id: 'e1', item_id: 'i1', kind: 'queda', event_date: '2026-10-25', created_at: 'x' })
    // Borrar el producto: la línea se queda sin producto; lo aprendido y las revisiones se van con él.
    await db.run("DELETE FROM pantry_items WHERE id = 'i1'")
    expect(await db.rows("SELECT item_id FROM pantry_ticket_lines WHERE id = 'l1'")).toEqual([{ item_id: null }])
    expect(await db.rows('SELECT name_key FROM pantry_aliases')).toEqual([{ name_key: 'BOLSA' }])
    expect(await db.rows('SELECT COUNT(*) AS n FROM pantry_events')).toEqual([{ n: 0 }])
    // Borrar el ticket borra sus líneas.
    await db.run("DELETE FROM pantry_tickets WHERE id = 't1'")
    expect(await db.rows('SELECT COUNT(*) AS n FROM pantry_ticket_lines')).toEqual([{ n: 0 }])
  })

  it('import_id y source_fingerprint admiten varios NULL, pero no el mismo valor dos veces', async () => {
    const { db } = await openTestDatabase()
    const insert = inserter(db)
    await insert('pantry_tickets', { ...TICKET, id: 'a', fingerprint: 'fa', import_id: null, source_fingerprint: null })
    await insert('pantry_tickets', { ...TICKET, id: 'b', fingerprint: 'fb', import_id: null, source_fingerprint: null })
    await insert('pantry_tickets', { ...TICKET, id: 'c', fingerprint: 'fc', import_id: 'lectura-0000000001', source_fingerprint: 'origen-000000000001' })
    await expect(insert('pantry_tickets', { ...TICKET, id: 'd', fingerprint: 'fd', import_id: 'lectura-0000000001' })).rejects.toEqual(mysqlError(1062))
    await expect(insert('pantry_tickets', { ...TICKET, id: 'e', fingerprint: 'fe', source_fingerprint: 'origen-000000000001' })).rejects.toEqual(mysqlError(1062))
    // Una huella de la primera versión de los tickets («tienda|fecha|hora|total») también cabe.
    await insert('pantry_tickets', { ...TICKET, id: 'f', fingerprint: `otra:${'X'.repeat(180)}|2026-10-29|12:34|-10000000` })
  })

  it('las claves comparan como SQLite: mayúsculas, tildes y espacios finales cuentan', async () => {
    const { db } = await openTestDatabase()
    const insert = inserter(db)
    for (const key of ['pina', 'piña', 'PINA', 'abc', 'abc ']) {
      await insert('pantry_aliases', { store: 'lidl', name_key: key, item_id: null, ignored: 1, updated_at: 'x' })
    }
    await expect(insert('pantry_aliases', { store: 'lidl', name_key: 'piña', item_id: null, ignored: 1, updated_at: 'x' })).rejects.toEqual(mysqlError(1062))
    // Orden binario, el de SQLite: mayúsculas antes que minúsculas y «ñ» después de «n».
    expect((await db.rows<{ k: string }>('SELECT name_key AS k FROM pantry_aliases ORDER BY name_key')).map((row) => row.k)).toEqual([
      'PINA',
      'abc',
      'abc ',
      'pina',
      'piña',
    ])
    expect(await db.rows("SELECT COUNT(*) AS n FROM pantry_aliases WHERE name_key = 'abc'")).toEqual([{ n: 1 }])
    // Y el CHECK de los textos fijos también distingue mayúsculas.
    await expect(insert('categories', { id: 'x', name: 'X', type: 'GASTO', order_index: 0 })).rejects.toEqual(mysqlError(3819))
  })

  it('guarda céntimos, milésimas, pesos y el orden sin perder precisión', async () => {
    const { db } = await openTestDatabase()
    const insert = inserter(db)
    await insert('movements', { ...MOVEMENT, id: 'max', amount_cents: MAX_CENTS })
    expect(await db.rows("SELECT amount_cents FROM movements WHERE id = 'max'")).toEqual([{ amount_cents: 99_999_999_999 }])
    await insert('pantry_items', { ...ITEM, id: 'q', unit: 'kg', quantity: 0.1 + 0.2, target: 999999.999 })
    await insert('pantry_items', { ...ITEM, id: 'm', unit: 'g', quantity: 0.001, target: 1_000_000 })
    expect(await db.rows("SELECT id, quantity, target FROM pantry_items WHERE id IN ('q', 'm') ORDER BY id")).toEqual([
      { id: 'm', quantity: 0.001, target: 1_000_000 },
      { id: 'q', quantity: 0.3, target: 999999.999 },
    ])
    await insert('pantry_tickets', { ...TICKET, id: 't1', fingerprint: 'h' })
    await insert('pantry_ticket_lines', { ...LINE, id: 'w', position: 0, item_id: null, weight_kg: 0.544 })
    await insert('pantry_ticket_lines', { ...LINE, id: 'w2', position: 1, item_id: null, weight_kg: 1000 })
    expect(await db.rows('SELECT weight_kg FROM pantry_ticket_lines ORDER BY position')).toEqual([{ weight_kg: 0.544 }, { weight_kg: 1000 }])
    await expect(insert('pantry_ticket_lines', { ...LINE, id: 'w3', position: 2, item_id: null, weight_kg: 0 })).rejects.toEqual(mysqlError(3819))
    // El orden de una categoría es un REAL de SQLite: DOUBLE lo conserva tal cual.
    await insert('categories', { id: 'o', name: 'Orden', type: 'gasto', order_index: 0.1 + 0.2 })
    expect(await db.rows("SELECT order_index FROM categories WHERE id = 'o'")).toEqual([{ order_index: 0.30000000000000004 }])
  })

  it('las fechas son DATE: se leen como AAAA-MM-DD y una fecha imposible se rechaza', async () => {
    const { db } = await openTestDatabase()
    const insert = inserter(db)
    await insert('movements', { ...MOVEMENT, id: 'f', paid_date: '2028-02-29', due_date: '1900-01-01' })
    expect(await db.rows("SELECT paid_date, due_date FROM movements WHERE id = 'f'")).toEqual([{ paid_date: '2028-02-29', due_date: '1900-01-01' }])
    await expect(insert('movements', { ...MOVEMENT, id: 'g', paid_date: '2026-02-30' })).rejects.toEqual(mysqlError(1292))
    expect(await db.rows("SELECT COUNT(*) AS n FROM movements WHERE paid_date >= ?", ['2028-01-01'])).toEqual([{ n: 1 }])
  })

  it('los JSON y los instantes se guardan como texto exacto', async () => {
    const { db } = await openTestDatabase()
    const insert = inserter(db)
    const adjustments = '[ {"b":1,  "a":"«ñ»"} ]'
    await insert('pantry_tickets', { ...TICKET, id: 'j', fingerprint: 'j', adjustments_json: adjustments, created_at: 'x'.repeat(40) })
    expect(await db.rows("SELECT adjustments_json, issues_json, created_at FROM pantry_tickets WHERE id = 'j'")).toEqual([
      { adjustments_json: adjustments, issues_json: '[]', created_at: 'x'.repeat(40) },
    ])
    // Lo que no cabe se rechaza (SQLite no tenía límites; los validadores de shared/ no dejan llegar a esto).
    await expect(insert('pantry_tickets', { ...TICKET, id: 'k', fingerprint: 'k', created_at: 'x'.repeat(41) })).rejects.toEqual(mysqlError(1406))
  })
})
