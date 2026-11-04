import type { Connection } from 'mysql2/promise'
import { afterEach, describe, expect, it } from 'vitest'
import type { PantryItem } from '#shared/pantry/types.ts'
import type { FinanceData } from '#shared/finance/types.ts'
import type { TicketSaveInput, TicketSaveLine } from '#shared/tickets/types.ts'
import { movement } from '#shared/testing/factories.ts'
import { startApi, stopApis, type TestApi } from '../../common/testing/testApi.ts'
import { connectTestDatabase, dropTestDatabases } from '../../common/testing/testDatabase.ts'

/**
 * Atomicidad de los tickets en MySQL (BASE-01 y MYSQL-02): un fallo real de
 * MySQL a mitad de un guardado (la segunda línea encuentra su id ocupado)
 * revierte también cabecera, productos, equivalencias, precios y cantidades.
 * Con dos conexiones, dos guardados iguales a la vez dan un 201 y un 409 sin
 * efectos dobles, y un ticket y un + a la vez sobre el mismo producto no se
 * pisan. Sin triggers: con el registro binario activo (lo normal en MySQL 8.4),
 * un usuario sin SUPER no puede crearlos.
 */

const NOW = '2026-11-01T08:00:00.000Z'
const PANTRY_TABLES = [
  'pantry_people', 'pantry_items', 'pantry_settings', 'pantry_events',
  'pantry_tickets', 'pantry_ticket_lines', 'pantry_aliases',
]
const ALL_TABLES = [
  ...PANTRY_TABLES, 'categories', 'movements', 'recurring_rules', 'recurring_excluded_dates', 'meta', 'schema_migrations', 'app_locks',
]

afterEach(async () => {
  await stopApis()
  await dropTestDatabases()
})

/** Compara cada campo de cada fila; los nombres de tabla proceden solo de las constantes del test. */
async function snapshot(db: Connection, tables = ALL_TABLES): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {}
  for (const table of tables) {
    const [rows] = await db.query(`SELECT * FROM ${table}`)
    result[table] = (rows as unknown[]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  return result
}

function line(rawName: string, amountCents: number): TicketSaveLine {
  return {
    rawName, quantity: 1, unitPriceCents: amountCents, amountCents, discountCents: 0,
    weightKg: null, pricePerKgCents: null, taxCode: 'A', occasional: false, confirmed: true,
  }
}

function ticket(lines: TicketSaveLine[], decisions: TicketSaveInput['decisions']): TicketSaveInput {
  return {
    store: 'otra', storeName: 'Tienda inventada', address: '', date: '2026-11-01', time: '10:00',
    totalCents: lines.reduce((total, entry) => total + (entry.amountCents ?? 0), 0),
    lines, decisions, acknowledged: true,
  }
}

const clock = { nowMs: () => Date.parse(NOW), nowISO: () => NOW, today: () => '2026-11-01' }

async function prepare(): Promise<{ api: TestApi; item: PantryItem; input: TicketSaveInput; useIds: (ids: string[]) => void }> {
  // Los ids de la cola se dan primero; después, «ensayo-N».
  const queue: string[] = []
  let id = 0
  const api = await startApi({ clock, ids: { newId: () => queue.shift() ?? `ensayo-${++id}` } })
  const created = await api.call('POST', '/despensa/productos', {
    name: 'Pan de ensayo', unit: 'ud', frequency: 'semanal', quantity: 1, target: 4, priceCents: 100,
  })
  expect(created.status).toBe(201)
  const item = created.body.data as PantryItem
  // Un ticket y una equivalencia previos evitan que comparar solo tablas vacías oculte una pérdida.
  const previous = ticket([line('AZUCAR', 90)], { AZUCAR: { kind: 'ignore' } })
  expect((await api.call('POST', '/despensa/tickets', { ...previous, date: '2026-10-31' })).status).toBe(201)
  const input = ticket([line('PAN', 200), line('TE', 250)], {
    PAN: { kind: 'item', itemId: item.id },
    TE: { kind: 'new', name: 'Té de ensayo', ownerId: null, frequency: 'mensual' },
  })
  input.importId = 'importacion-sintetica-0001'
  input.sourceFingerprint = 'origen-sintetico-0001'
  return { api, item, input, useIds: (ids) => queue.push(...ids) }
}

const items = async (api: TestApi) => (await api.call('GET', '/despensa/productos')).body.data as PantryItem[]

describe('atomicidad e independencia de tickets', () => {
  it('revierte todos los efectos ante un fallo en la segunda línea y admite después un único reintento', async () => {
    const { api, item, input, useIds } = await prepare()
    const db = await connectTestDatabase(api.database)
    // La segunda línea del ticket se encontrará su id ocupado: una clave primaria repetida, a mitad del guardado,
    // después de crear el producto nuevo, aprender las equivalencias, cambiar precio y cantidad y guardar la cabecera.
    const [[previousTicket]] = (await db.query('SELECT id FROM pantry_tickets')) as unknown as [{ id: string }[]]
    await db.query(
      "INSERT INTO pantry_ticket_lines (id, ticket_id, position, raw_name, name_key, quantity) VALUES ('linea-ocupada', ?, 1, 'OCUPADA', 'OCUPADA', 1)",
      [previousTicket.id],
    )
    const before = await snapshot(db)
    useIds(['te-nuevo', 'ticket-nuevo', 'linea-primera', 'linea-ocupada'])
    const failed = await api.call('POST', '/despensa/tickets', input, { cookie: null })
    expect(failed.status).toBe(409)
    expect(failed.body).toEqual({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: 'Los datos no encajan con los que ya están guardados, así que no se ha cambiado nada.',
      },
    })
    expect(await snapshot(db)).toEqual(before)

    await db.query("DELETE FROM pantry_ticket_lines WHERE id = 'linea-ocupada'")
    const saved = await api.call('POST', '/despensa/tickets', input, { cookie: null })
    expect(saved.status).toBe(201)
    const list = await items(api)
    // Cambiar el precio y sumar la cantidad son dos escrituras: cada una incrementa la versión.
    expect(list.find((entry) => entry.id === item.id)).toEqual({ ...item, quantity: 2, priceCents: 200, version: 3 })
    expect(list.map((entry) => entry.name).sort()).toEqual(['Pan de ensayo', 'Té de ensayo'])
    const after = await snapshot(db)
    expect(after.pantry_tickets).toHaveLength(2)
    expect(after.pantry_ticket_lines).toHaveLength(3)
    expect(after.pantry_aliases).toHaveLength(3)
    for (const table of ALL_TABLES.filter((name) => !name.startsWith('pantry_'))) {
      expect(after[table], table).toEqual(before[table])
    }

    expect((await api.call('POST', '/despensa/tickets', input, { cookie: null })).status).toBe(409)
    expect(await snapshot(db)).toEqual(after)
  })

  it('dos guardados del mismo ticket a la vez, desde dos conexiones: un 201 y un 409, sin efectos dobles', async () => {
    const { api, item, input } = await prepare()
    const other = await startApi({ database: api.database, clock })
    const results = await Promise.all([
      api.call('POST', '/despensa/tickets', input, { cookie: null }),
      other.call('POST', '/despensa/tickets', input, { cookie: null }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([201, 409])
    expect(results.find((result) => result.status === 409)?.body.error?.message).toBe('Este ticket ya está guardado (Tienda inventada, 01/11/2026).')

    const db = await connectTestDatabase(api.database)
    const after = await snapshot(db, PANTRY_TABLES)
    expect(after.pantry_tickets).toHaveLength(2)
    expect(after.pantry_ticket_lines).toHaveLength(3)
    expect(after.pantry_aliases).toHaveLength(3)
    const list = await items(api)
    // Precio y cantidad una sola vez, y un solo «Té de ensayo».
    expect(list.find((entry) => entry.id === item.id)).toEqual({ ...item, quantity: 2, priceCents: 200, version: 3 })
    expect(list.map((entry) => entry.name).sort()).toEqual(['Pan de ensayo', 'Té de ensayo'])
  })

  it('un ticket y un + a la vez sobre el mismo producto, desde dos conexiones, no se pisan', async () => {
    const { api, item, input } = await prepare()
    const other = await startApi({ database: api.database, clock, login: false })
    const [saved, adjusted] = await Promise.all([
      api.call('POST', '/despensa/tickets', input, { cookie: null }),
      other.call('POST', `/despensa/productos/${item.id}/ajustar`, { delta: 1 }, { cookie: null }),
    ])
    expect([saved.status, adjusted.status]).toEqual([201, 200])
    // 1 de antes, +1 del ticket y +1 del botón, en el orden que sea; tres escrituras, tres versiones más.
    expect((await items(api)).find((entry) => entry.id === item.id)).toEqual({ ...item, quantity: 3, priceCents: 200, version: 4 })
  })

  it('restaurar finanzas conserva íntegros productos, tickets, líneas y equivalencias', async () => {
    const { api, input } = await prepare()
    expect((await api.call('POST', '/despensa/tickets', input)).status).toBe(201)
    const expense = movement({ id: 'gasto-de-ensayo', createdAt: NOW, updatedAt: NOW })
    expect((await api.call('PUT', `/movements/${expense.id}`, expense)).status).toBe(200)
    const db = await connectTestDatabase(api.database)
    const before = await snapshot(db, PANTRY_TABLES)
    const data = (await api.call('GET', '/data')).body.data as FinanceData
    expect(data.movements).toHaveLength(1)
    expect((await api.call('PUT', '/data', { ...data, movements: [] })).body).toEqual({ ok: true, data: null })
    expect(((await api.call('GET', '/data')).body.data as FinanceData).movements).toEqual([])
    expect(await snapshot(db, PANTRY_TABLES)).toEqual(before)
  })
})
