import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { PantryItem } from '#shared/pantry/types.ts'
import type { FinanceData } from '#shared/finance/types.ts'
import type { TicketSaveInput, TicketSaveLine } from '#shared/tickets/types.ts'
import { movement } from '#shared/testing/factories.ts'
import { startApi, stopApis, type TestApi } from '../../common/testing/testApi.ts'
import { removeTempDbs } from '../../common/testing/tempDb.ts'

/**
 * BASE-01: un fallo real de SQLite después de insertar la primera línea debe
 * revertir también cabecera, productos, equivalencias, precios y cantidades.
 * El trigger solo existe en una base temporal de ensayo; no cambia migraciones.
 */

const NOW = '2026-11-01T08:00:00.000Z'
const PANTRY_TABLES = [
  'pantry_people', 'pantry_items', 'pantry_settings', 'pantry_events',
  'pantry_tickets', 'pantry_ticket_lines', 'pantry_aliases',
]
const ALL_TABLES = [
  ...PANTRY_TABLES, 'categories', 'movements', 'recurring_rules', 'recurring_excluded_dates', 'meta', 'schema_migrations',
]

afterEach(async () => {
  await stopApis()
  removeTempDbs()
})

/** Compara cada campo de cada fila; los nombres de tabla proceden solo de las constantes del test. */
function snapshot(db: Database.Database, tables = ALL_TABLES): Record<string, unknown[]> {
  return Object.fromEntries(tables.map((table) => [
    table,
    db.prepare(`SELECT * FROM ${table}`).all().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ]))
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

async function prepare(): Promise<{ api: TestApi; item: PantryItem; input: TicketSaveInput }> {
  let id = 0
  const api = await startApi({
    clock: { nowMs: () => Date.parse(NOW), nowISO: () => NOW, today: () => '2026-11-01' },
    ids: { newId: () => `ensayo-${++id}` },
  })
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
  return { api, item, input }
}

describe('atomicidad e independencia de tickets para BASE-01', () => {
  it('revierte todos los efectos ante un fallo en la segunda línea y admite después un único reintento', async () => {
    const { api, item, input } = await prepare()
    const db = new Database(api.path)
    try {
      const before = snapshot(db)
      db.exec(`CREATE TRIGGER fallo_sintetico_segunda_linea BEFORE INSERT ON pantry_ticket_lines
        WHEN NEW.position = 1 BEGIN SELECT RAISE(ABORT, 'fallo sintético tras primera línea'); END`)
      const failed = await api.call('POST', '/despensa/tickets', input, { cookie: null })
      expect(failed.status).toBe(409)
      expect(failed.body).toEqual({
        ok: false,
        error: {
          code: 'CONFLICT',
          message: 'Los datos no encajan con los que ya están guardados, así que no se ha cambiado nada.',
        },
      })
      expect(snapshot(db)).toEqual(before)

      db.exec('DROP TRIGGER fallo_sintetico_segunda_linea')
      const saved = await api.call('POST', '/despensa/tickets', input, { cookie: null })
      expect(saved.status).toBe(201)
      const items = (await api.call('GET', '/despensa/productos')).body.data as PantryItem[]
      // Cambiar el precio y sumar la cantidad son dos escrituras: cada una incrementa la versión.
      expect(items.find((entry) => entry.id === item.id)).toEqual({ ...item, quantity: 2, priceCents: 200, version: 3 })
      expect(items.map((entry) => entry.name).sort()).toEqual(['Pan de ensayo', 'Té de ensayo'])
      const after = snapshot(db)
      expect(after.pantry_tickets).toHaveLength(2)
      expect(after.pantry_ticket_lines).toHaveLength(3)
      expect(after.pantry_aliases).toHaveLength(3)
      for (const table of ALL_TABLES.filter((name) => !name.startsWith('pantry_'))) {
        expect(after[table], table).toEqual(before[table])
      }

      expect((await api.call('POST', '/despensa/tickets', input, { cookie: null })).status).toBe(409)
      expect(snapshot(db)).toEqual(after)
    } finally {
      db.close()
    }
  })

  it('restaurar finanzas conserva íntegros productos, tickets, líneas y equivalencias', async () => {
    const { api, input } = await prepare()
    expect((await api.call('POST', '/despensa/tickets', input)).status).toBe(201)
    const expense = movement({ id: 'gasto-de-ensayo', createdAt: NOW, updatedAt: NOW })
    expect((await api.call('PUT', `/movements/${expense.id}`, expense)).status).toBe(200)
    const db = new Database(api.path, { readonly: true })
    try {
      const before = snapshot(db, PANTRY_TABLES)
      const data = (await api.call('GET', '/data')).body.data as FinanceData
      expect(data.movements).toHaveLength(1)
      expect((await api.call('PUT', '/data', { ...data, movements: [] })).body).toEqual({ ok: true, data: null })
      expect(((await api.call('GET', '/data')).body.data as FinanceData).movements).toEqual([])
      expect(snapshot(db, PANTRY_TABLES)).toEqual(before)
    } finally {
      db.close()
    }
  })
})
