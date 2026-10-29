import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '#shared/finance/categories.ts'
import type { FinanceData } from '#shared/finance/types.ts'
import type { PantryItem, PantryPerson, PantryPurchaseChange } from '#shared/pantry/types.ts'
import { movement } from '#shared/testing/factories.ts'
import { startApi, stopApis, type TestApi } from '../../common/testing/testApi.ts'
import { removeTempDbs } from '../../common/testing/tempDb.ts'

afterEach(async () => {
  await stopApis()
  removeTempDbs()
})

const milk = { name: 'Leche', ownerId: null, unit: 'l', quantity: 2, target: 6, frequency: 'semanal', priceCents: 95, notes: '' }

/** Como invitado: la despensa es pública. */
const guest = (api: TestApi) => ({
  call: (method: string, path: string, body?: unknown) => api.call(method, path, body, { cookie: null }),
})

async function createItem(api: TestApi, overrides: Record<string, unknown> = {}): Promise<PantryItem> {
  const result = await guest(api).call('POST', '/despensa/productos', { ...milk, ...overrides })
  expect(result.status).toBe(201)
  return result.body.data as PantryItem
}

async function createPerson(api: TestApi, name: string): Promise<PantryPerson> {
  const result = await guest(api).call('POST', '/despensa/personas', { name })
  expect(result.status).toBe(201)
  return result.body.data as PantryPerson
}

const items = async (api: TestApi) => (await guest(api).call('GET', '/despensa/productos')).body.data as PantryItem[]

describe('API de la despensa', () => {
  it('un invitado gestiona personas: crear, listar por nombre, renombrar y borrar', async () => {
    const api = await startApi({ login: false })
    const g = guest(api)
    const eloy = await createPerson(api, '  Eloy ')
    expect(eloy).toMatchObject({ name: 'Eloy' })
    expect(eloy.id).toMatch(/^[0-9a-f-]{36}$/)
    await createPerson(api, 'Ana')
    expect(((await g.call('GET', '/despensa/personas')).body.data as PantryPerson[]).map((p) => p.name)).toEqual(['Ana', 'Eloy'])

    expect((await g.call('PUT', `/despensa/personas/${eloy.id}`, { name: 'Eloy C.' })).body.data).toMatchObject({ name: 'Eloy C.' })
    expect((await g.call('PUT', '/despensa/personas/no-existe', { name: 'X' })).status).toBe(404)
    expect((await g.call('POST', '/despensa/personas', { name: '' })).status).toBe(400)
    expect((await g.call('POST', '/despensa/personas', { name: 'x'.repeat(41) })).status).toBe(400)

    expect((await g.call('DELETE', `/despensa/personas/${eloy.id}`)).status).toBe(200)
    expect((await g.call('DELETE', `/despensa/personas/${eloy.id}`)).status).toBe(404)
  })

  it('no deja borrar una persona con productos y no cambia nada', async () => {
    const api = await startApi({ login: false })
    const eloy = await createPerson(api, 'Eloy')
    await createItem(api, { name: 'Proteína', ownerId: eloy.id, unit: 'bolsa', quantity: 0, target: 1 })
    const result = await guest(api).call('DELETE', `/despensa/personas/${eloy.id}`)
    expect(result.status).toBe(409)
    expect(result.body.error).toEqual({
      code: 'CONFLICT',
      message: '«Eloy» tiene un producto. Pásalos a otra persona o a «Compartido», o elimínalos, antes de borrarla.',
    })
    expect((await guest(api).call('GET', '/despensa/personas')).body.data).toEqual([eloy])
    expect(await items(api)).toHaveLength(1)
  })

  it('crea, edita y borra productos; el servidor pone id, versión y fechas', async () => {
    let tick = 0
    const api = await startApi({ login: false, clock: { nowISO: () => `2026-10-29T08:00:0${tick++}.000Z` } })
    const created = await createItem(api, { name: ' Leche ', notes: ' entera ' })
    expect(created).toMatchObject({ ...milk, notes: 'entera', version: 1, createdAt: '2026-10-29T08:00:00.000Z' })
    expect(created.createdAt).toBe(created.updatedAt)

    const edited = await guest(api).call('PUT', `/despensa/productos/${created.id}`, { ...milk, target: 8, priceCents: null })
    expect(edited.status).toBe(200)
    expect(edited.body.data).toMatchObject({ target: 8, priceCents: null, version: 2, createdAt: created.createdAt })
    expect((edited.body.data as PantryItem).updatedAt).not.toBe(created.updatedAt)

    expect((await guest(api).call('PUT', '/despensa/productos/no-existe', milk)).status).toBe(404)
    expect((await guest(api).call('DELETE', `/despensa/productos/${created.id}`)).status).toBe(200)
    expect((await guest(api).call('DELETE', `/despensa/productos/${created.id}`)).status).toBe(404)
    expect(await items(api)).toEqual([])
  })

  it('valida unidades, frecuencias, cantidades, dueños, precios y opcionales', async () => {
    const api = await startApi({ login: false })
    const g = guest(api)
    const bad: Record<string, unknown>[] = [
      { unit: 'barril' },
      { frequency: 'diaria' },
      { quantity: -1 },
      { target: Number.MAX_VALUE },
      { quantity: 1.5, unit: 'ud' },
      { quantity: 0.0001, unit: 'kg' },
      { priceCents: 1.5 },
      { priceCents: -5 },
      { ownerId: 'no-existe' },
      { name: '' },
      { notes: 'x'.repeat(121) },
    ]
    for (const overrides of bad) {
      const result = await g.call('POST', '/despensa/productos', { ...milk, ...overrides })
      expect([overrides, result.status]).toEqual([overrides, 400])
    }
    expect((await g.call('POST', '/despensa/productos', undefined)).status).toBe(400)
    expect(await items(api)).toEqual([])

    // Existencias por encima del objetivo, precio 0 y sin notas: válido.
    const ok = await createItem(api, { quantity: 9, target: 6, priceCents: 0, notes: undefined })
    expect(ok).toMatchObject({ quantity: 9, target: 6, priceCents: 0, notes: '' })
    // Cambiar a una unidad entera con cantidades decimales se rechaza sin redondear.
    const kg = await createItem(api, { name: 'Arroz', unit: 'kg', quantity: 1.5, target: 2 })
    expect((await g.call('PUT', `/despensa/productos/${kg.id}`, { ...milk, name: 'Arroz', unit: 'paquete', quantity: 1.5, target: 2 })).status).toBe(400)
    expect((await items(api)).find((i) => i.id === kg.id)).toMatchObject({ unit: 'kg', quantity: 1.5 })
  })

  it('los botones + y − ajustan sobre el valor del servidor y nunca bajan de cero', async () => {
    const api = await startApi({ login: false })
    const g = guest(api)
    const rice = await createItem(api, { name: 'Arroz', unit: 'kg', quantity: 0.3, target: 2 })
    expect((await g.call('POST', `/despensa/productos/${rice.id}/ajustar`, { delta: 0.5 })).body.data).toMatchObject({ quantity: 0.8, version: 2 })
    expect((await g.call('POST', `/despensa/productos/${rice.id}/ajustar`, { delta: -5 })).body.data).toMatchObject({ quantity: 0 })
    expect((await g.call('POST', `/despensa/productos/${rice.id}/ajustar`, { delta: 0 })).status).toBe(400)
    const eggs = await createItem(api, { name: 'Huevos', unit: 'docena', quantity: 1, target: 2 })
    expect((await g.call('POST', `/despensa/productos/${eggs.id}/ajustar`, { delta: 0.5 })).status).toBe(400)
    expect((await g.call('POST', '/despensa/productos/no-existe/ajustar', { delta: 1 })).status).toBe(404)
  })

  it('consulta, fija y quita el presupuesto, distinguiendo 0 de sin presupuesto', async () => {
    const api = await startApi({ login: false })
    const g = guest(api)
    expect((await g.call('GET', '/despensa/presupuesto')).body.data).toEqual({ monthlyBudgetCents: null, lastReviewDate: null })
    expect((await g.call('PUT', '/despensa/presupuesto', { monthlyBudgetCents: 0 })).body.data).toEqual({ monthlyBudgetCents: 0, lastReviewDate: null })
    expect((await g.call('PUT', '/despensa/presupuesto', { monthlyBudgetCents: 25000 })).body.data).toEqual({ monthlyBudgetCents: 25000, lastReviewDate: null })
    expect((await g.call('PUT', '/despensa/presupuesto', { monthlyBudgetCents: -1 })).status).toBe(400)
    expect((await g.call('PUT', '/despensa/presupuesto', {})).status).toBe(400)
    expect((await g.call('PUT', '/despensa/presupuesto', { monthlyBudgetCents: null })).body.data).toEqual({ monthlyBudgetCents: null, lastReviewDate: null })
  })
})

describe('marcar como comprado y deshacer', () => {
  async function setup() {
    const api = await startApi({ login: false })
    const milkItem = await createItem(api, { name: 'Leche', quantity: 2, target: 6 })
    const eggs = await createItem(api, { name: 'Huevos', unit: 'docena', quantity: 0, target: 1 })
    const salt = await createItem(api, { name: 'Sal', unit: 'paquete', quantity: 3, target: 1 })
    return { api, g: guest(api), milkItem, eggs, salt }
  }

  it('completa las existencias de varios productos, sin repetir ids y sin reducir lo que sobra', async () => {
    const { api, g, milkItem, eggs, salt } = await setup()
    const result = await g.call('POST', '/despensa/comprado', { ids: [milkItem.id, eggs.id, milkItem.id, salt.id] })
    expect(result.status).toBe(200)
    const { changes } = result.body.data as { changes: PantryPurchaseChange[]; items: PantryItem[] }
    expect(changes).toEqual(
      expect.arrayContaining([
        { id: milkItem.id, previousQuantity: 2, version: 2 },
        { id: eggs.id, previousQuantity: 0, version: 2 },
      ]),
    )
    expect(changes).toHaveLength(2)
    const after = await items(api)
    expect(after.find((i) => i.id === milkItem.id)?.quantity).toBe(6)
    expect(after.find((i) => i.id === eggs.id)?.quantity).toBe(1)
    expect(after.find((i) => i.id === salt.id)).toMatchObject({ quantity: 3, version: 1 })

    // Repetirlo no cambia nada.
    const again = await g.call('POST', '/despensa/comprado', { ids: [milkItem.id, eggs.id] })
    expect((again.body.data as { changes: unknown[] }).changes).toEqual([])
  })

  it('rechaza listas vacías o con ids que no existen, sin escribir nada', async () => {
    const { api, g, milkItem } = await setup()
    expect((await g.call('POST', '/despensa/comprado', { ids: [] })).status).toBe(400)
    expect((await g.call('POST', '/despensa/comprado', { ids: [42] })).status).toBe(400)
    expect((await g.call('POST', '/despensa/comprado', {})).status).toBe(400)
    const missing = await g.call('POST', '/despensa/comprado', { ids: [milkItem.id, 'no-existe'] })
    expect(missing.status).toBe(404)
    expect((await items(api)).find((i) => i.id === milkItem.id)).toMatchObject({ quantity: 2, version: 1 })
  })

  it('deshacer devuelve las cantidades anteriores, solo la cantidad, y persiste', async () => {
    const { api, g, milkItem, eggs } = await setup()
    const { changes } = (await g.call('POST', '/despensa/comprado', { ids: [milkItem.id, eggs.id] })).body.data as {
      changes: PantryPurchaseChange[]
    }
    const undone = await g.call('POST', '/despensa/comprado/deshacer', { changes })
    expect(undone.status).toBe(200)
    const after = await items(api)
    expect(after.find((i) => i.id === milkItem.id)).toMatchObject({ quantity: 2, target: 6, name: 'Leche', version: 3 })
    expect(after.find((i) => i.id === eggs.id)).toMatchObject({ quantity: 0, version: 3 })

    // Persistido en SQLite: otra instancia del servidor lo ve igual.
    await api.stop()
    const reopened = await startApi({ path: api.path, login: false })
    expect((await items(reopened)).find((i) => i.id === milkItem.id)?.quantity).toBe(2)

    // Deshacer dos veces no vuelve a aplicar nada.
    expect((await guest(reopened).call('POST', '/despensa/comprado/deshacer', { changes })).status).toBe(409)
  })

  it('si algo cambió después de la compra, 409 sin revertir nada a medias ni pisar el cambio', async () => {
    const { api, g, milkItem, eggs } = await setup()
    const { changes } = (await g.call('POST', '/despensa/comprado', { ids: [milkItem.id, eggs.id] })).body.data as {
      changes: PantryPurchaseChange[]
    }
    // Mientras, desde otro móvil alguien gasta la docena de huevos.
    await g.call('POST', `/despensa/productos/${eggs.id}/ajustar`, { delta: -1 })
    const result = await g.call('POST', '/despensa/comprado/deshacer', { changes })
    expect(result.status).toBe(409)
    expect(result.body.error?.message).toMatch(/ha cambiado/)
    const after = await items(api)
    expect(after.find((i) => i.id === milkItem.id)?.quantity).toBe(6)
    expect(after.find((i) => i.id === eggs.id)?.quantity).toBe(0)
    expect((await g.call('POST', '/despensa/comprado/deshacer', { changes: [] })).status).toBe(400)
  })
})

describe('la despensa no se mezcla con las finanzas', () => {
  it('restaurar una copia financiera y la importación del navegador conservan la despensa', async () => {
    const api = await startApi()
    const eloy = await createPerson(api, 'Eloy')
    const own = await createItem(api, { ownerId: eloy.id, name: 'Proteína', unit: 'bolsa', quantity: 0, target: 1 })
    await guest(api).call('PUT', '/despensa/presupuesto', { monthlyBudgetCents: 30000 })

    // La importación del navegador funciona con productos en la despensa (no cuenta como «datos del usuario»).
    const browser: FinanceData = { categories: [...DEFAULT_CATEGORIES], movements: [movement({ concept: 'Del navegador' })], recurring: [] }
    expect((await api.call('POST', '/import', { data: browser, lastBackupAt: null })).status).toBe(201)

    // Restaurar una copia sustituye solo las finanzas.
    const restored = { categories: DEFAULT_CATEGORIES, movements: [movement({ concept: 'De la copia' })], recurring: [] }
    expect((await api.call('PUT', '/data', restored)).status).toBe(200)

    const data = (await api.call('GET', '/data')).body.data as Record<string, unknown>
    expect(Object.keys(data).sort()).toEqual(['categories', 'movements', 'recurring'])
    expect(JSON.stringify(data)).not.toContain('Proteína')
    expect(await items(api)).toEqual([own])
    expect((await guest(api).call('GET', '/despensa/personas')).body.data).toEqual([eloy])
    expect((await guest(api).call('GET', '/despensa/presupuesto')).body.data).toEqual({ monthlyBudgetCents: 30000, lastReviewDate: null })
  })

  it('el reinicio de pruebas también vacía la despensa', async () => {
    const api = await startApi({ testMode: true })
    await createPerson(api, 'Eloy')
    await createItem(api)
    await guest(api).call('PUT', '/despensa/presupuesto', { monthlyBudgetCents: 100 })
    expect((await api.call('POST', '/test/reset')).status).toBe(200)
    expect(await items(api)).toEqual([])
    expect((await guest(api).call('GET', '/despensa/personas')).body.data).toEqual([])
    expect((await guest(api).call('GET', '/despensa/presupuesto')).body.data).toEqual({ monthlyBudgetCents: null, lastReviewDate: null })
  })
})
