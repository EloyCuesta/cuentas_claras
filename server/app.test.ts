import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '#shared/finance/categories.ts'
import type { FinanceData } from '#shared/finance/types.ts'
import { movement, rule } from '#shared/testing/factories.ts'
import { startApi, stopApis, type TestApi } from './api-test-helpers.ts'
import { LATEST_VERSION } from './migrations/index.ts'
import { removeTempDbs } from './test-helpers.ts'

/** Pruebas de la API por HTTP: un servidor real en un puerto libre y fetch, con la sesión iniciada. */

afterEach(async () => {
  await stopApis()
  removeTempDbs()
})

const dataOf = async (call: TestApi['call']) => (await call('GET', '/data')).body.data as FinanceData

describe('API', () => {
  it('GET /api/health responde con el estado, sin revelar datos', async () => {
    const { call } = await startApi({ login: false })
    // Pública y sin datos: ni la ruta del archivo ni nada financiero.
    expect((await call('GET', '/health')).body).toEqual({ ok: true, data: { status: 'ok', schemaVersion: LATEST_VERSION } })
  })

  it('crea, consulta, modifica y elimina un gasto, y persiste tras reiniciar el servidor', async () => {
    const first = await startApi()
    const expense = movement({ concept: 'Mercadona', amountCents: 5430 })

    expect(await first.call('PUT', `/movements/${expense.id}`, expense)).toMatchObject({ status: 200, body: { ok: true, data: null } })
    expect((await dataOf(first.call)).movements).toEqual([expense])

    const edited = { ...expense, amountCents: 6000, updatedAt: '2026-10-29T08:00:00.000Z' }
    await first.call('PUT', `/movements/${expense.id}`, edited)
    expect((await dataOf(first.call)).movements).toEqual([edited])

    // Reiniciar el servidor con el mismo archivo: el gasto sigue ahí.
    await first.stop()
    const second = await startApi({ path: first.path })
    expect((await dataOf(second.call)).movements).toEqual([edited])

    expect((await second.call('DELETE', `/movements/${expense.id}`)).status).toBe(200)
    expect((await dataOf(second.call)).movements).toEqual([])
  })

  it('valida las peticiones con mensajes en español', async () => {
    const { call } = await startApi()
    const expense = movement()

    const missing = await call('PUT', `/movements/${expense.id}`, { ...expense, concept: '' })
    expect(missing).toMatchObject({ status: 400, body: { ok: false, error: { code: 'VALIDATION', message: 'El movimiento: el campo «concept» está vacío.' } } })
    expect((await call('PUT', '/movements/otro-id', expense)).body.error?.message).toMatch(/no coincide/)
    expect((await call('PUT', `/movements/${expense.id}`, undefined, { raw: '{"roto"' })).status).toBe(400)
    expect((await call('PUT', `/movements/${expense.id}`, { ...expense, amountCents: 12.5 })).status).toBe(400)
    expect((await call('PUT', `/movements/${expense.id}`, { ...expense, categoryId: 'no-existe' })).body.error?.code).toBe('VALIDATION')
    expect((await call('POST', '/occurrences/generate', { horizon: '30/11/2026' })).status).toBe(400)
    expect((await dataOf(call)).movements).toEqual([])
  })

  it('no permite inyectar SQL: los textos se guardan tal cual', async () => {
    const { call } = await startApi()
    const tricky = movement({ id: "x'); DROP TABLE movements; --", concept: "Robert'); DROP TABLE movements;--" })
    expect((await call('PUT', `/movements/${encodeURIComponent(tricky.id)}`, tricky)).status).toBe(200)
    expect((await dataOf(call)).movements).toEqual([tricky])
  })

  it('devuelve 409 en los conflictos sin cambiar nada', async () => {
    const { call } = await startApi()
    const occurrence = { recurringId: 'r1', occurrenceDate: '2026-11-01', status: 'pendiente' as const, paidDate: null, dueDate: '2026-11-01' }
    const a = movement(occurrence)
    const b = movement(occurrence)
    await call('PUT', `/movements/${a.id}`, a)
    expect(await call('PUT', `/movements/${b.id}`, b)).toMatchObject({
      status: 409,
      body: { ok: false, error: { code: 'CONFLICT', message: 'Ese vencimiento ya existe, así que no se ha creado otro.' } },
    })
    expect((await call('DELETE', '/categories/g-alimentacion')).status).toBe(409)
    expect((await call('DELETE', '/categories/g-alimentacion?replacementId=g-otros')).status).toBe(200)
    expect((await dataOf(call)).movements.map((m) => m.categoryId)).toEqual(['g-otros'])
  })

  it('genera los vencimientos de un recurrente sin duplicarlos', async () => {
    const { call } = await startApi()
    const rent = rule({ startDate: '2026-09-01' })
    expect((await call('PUT', `/recurring/${rent.id}`, { rule: rent, horizon: '2026-11-30', markPaidBefore: null })).body).toEqual({
      ok: true,
      data: { created: 3 },
    })
    expect((await call('POST', '/occurrences/generate', { horizon: '2026-11-30' })).body.data).toEqual({ created: 0 })
    await call('DELETE', `/recurring/${rent.id}`)
    expect(await dataOf(call)).toMatchObject({ recurring: [], movements: [] })
  })

  it('restaura una copia completa y rechaza una incoherente sin tocar los datos', async () => {
    const { call } = await startApi()
    const data = await dataOf(call)
    const restored = { ...data, movements: [movement({ concept: 'De la copia' })] }
    expect((await call('PUT', '/data', restored)).status).toBe(200)
    expect((await dataOf(call)).movements.map((m) => m.concept)).toEqual(['De la copia'])

    const broken = { ...data, movements: [movement({ categoryId: 'no-existe' })] }
    const rejected = await call('PUT', '/data', broken)
    expect(rejected.status).toBe(400)
    expect(rejected.body.error?.message).toMatch(/categoría que no existe/)
    expect((await dataOf(call)).movements.map((m) => m.concept)).toEqual(['De la copia'])
  })

  it('importa los datos del navegador una sola vez', async () => {
    const { call } = await startApi()
    const browser = { categories: DEFAULT_CATEGORIES, movements: [movement()], recurring: [] }
    const imported = await call('POST', '/import', { data: browser, lastBackupAt: '2026-10-01T10:00:00.000Z' })
    expect(imported).toMatchObject({ status: 201, body: { ok: true, data: { categories: DEFAULT_CATEGORIES.length, movements: 1, recurring: 0 } } })
    expect((await call('POST', '/import', { data: browser, lastBackupAt: null })).status).toBe(409)
    expect((await dataOf(call)).movements).toHaveLength(1)
    expect((await call('GET', '/meta/lastBackupAt')).body.data).toEqual({ value: '2026-10-01T10:00:00.000Z' })
  })

  it('guarda los datos auxiliares y rechaza claves desconocidas', async () => {
    const { call } = await startApi()
    expect((await call('GET', '/meta/lastBackupAt')).body.data).toEqual({ value: null })
    await call('PUT', '/meta/lastBackupAt', { value: '2026-10-28T08:00:00.000Z' })
    expect((await call('GET', '/meta/lastBackupAt')).body.data).toEqual({ value: '2026-10-28T08:00:00.000Z' })
    expect((await call('GET', '/meta/otra')).status).toBe(404)
  })

  it('el reinicio para pruebas solo existe en modo pruebas', async () => {
    const normal = await startApi()
    expect((await normal.call('POST', '/test/reset')).status).toBe(404)

    const testing = await startApi({ testMode: true })
    const extra = movement()
    await testing.call('PUT', `/movements/${extra.id}`, extra)
    expect((await testing.call('POST', '/test/reset')).status).toBe(200)
    expect((await dataOf(testing.call)).movements).toEqual([])
  })
})
