import { afterEach, describe, expect, it } from 'vitest'
import { parseBackup, serializeBackup } from '#shared/finance/backup.ts'
import { DEFAULT_CATEGORIES } from '#shared/finance/categories.ts'
import { generationHorizon } from '#shared/finance/recurring.ts'
import { monthPeriod } from '#shared/finance/period.ts'
import { periodSummary } from '#shared/finance/summary.ts'
import { markAsPaid } from '#shared/finance/validation.ts'
import { movement, NOW, rule } from '#shared/testing/factories.ts'
import { IndexedDbFinanceRepository } from './IndexedDbFinanceRepository.ts'

/**
 * Pruebas del almacenamiento con una IndexedDB en memoria (fake-indexeddb).
 * Cubren las comprobaciones pedidas: persistencia, totales al editar o
 * eliminar, pagos sin duplicar, vencimientos sin duplicar y copia de seguridad.
 */

let dbCounter = 0
const opened: IndexedDbFinanceRepository[] = []

function openRepository(dbName = `test-${++dbCounter}`) {
  const repository = new IndexedDbFinanceRepository({ dbName, now: () => NOW })
  opened.push(repository)
  return { repository, dbName }
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((r) => r.close()))
})

const TODAY = '2026-10-28'
const HORIZON = generationHorizon(TODAY) // 30/11/2026

describe('IndexedDbFinanceRepository', () => {
  it('empieza sin movimientos y con las categorías iniciales', async () => {
    const { repository } = openRepository()
    const data = await repository.loadAll()
    expect(data.movements).toEqual([])
    expect(data.recurring).toEqual([])
    expect(data.categories).toHaveLength(DEFAULT_CATEGORIES.length)
  })

  it('los movimientos se conservan después de recargar', async () => {
    const { repository, dbName } = openRepository()
    const saved = movement({ concept: 'Mercadona', amountCents: 4520 })
    await repository.saveMovement(saved)
    await repository.close()

    const { repository: reopened } = openRepository(dbName)
    expect((await reopened.loadAll()).movements).toEqual([saved])
  })

  it('las categorías iniciales no reaparecen al volver a abrir', async () => {
    const { repository, dbName } = openRepository()
    await repository.deleteCategory('g-ocio', null)
    await repository.close()
    const { repository: reopened } = openRepository(dbName)
    const ids = (await reopened.loadAll()).categories.map((c) => c.id)
    expect(ids).not.toContain('g-ocio')
  })

  it('editar o eliminar un movimiento actualiza los totales', async () => {
    const { repository } = openRepository()
    const food = movement({ amountCents: 5000, paidDate: '2026-10-10' })
    const fuel = movement({ amountCents: 6000, paidDate: '2026-10-11', categoryId: 'g-coche-combustible' })
    await repository.saveMovement(food)
    await repository.saveMovement(fuel)
    const expensePaid = async () => periodSummary((await repository.loadAll()).movements, monthPeriod(2026, 10)).expensePaid

    expect(await expensePaid()).toBe(11000)
    await repository.saveMovement({ ...food, amountCents: 7550 })
    expect(await expensePaid()).toBe(13550)
    await repository.deleteMovement(fuel.id)
    expect(await expensePaid()).toBe(7550)
    expect((await repository.loadAll()).movements).toHaveLength(1)
  })

  it('marcar un pago pendiente como pagado no duplica el gasto', async () => {
    const { repository } = openRepository()
    const pending = movement({ status: 'pendiente', paidDate: null, dueDate: '2026-10-30', amountCents: 7235 })
    await repository.saveMovement(pending)
    expect(periodSummary((await repository.loadAll()).movements, monthPeriod(2026, 10))).toMatchObject({
      expensePaid: 0,
      expensePending: 7235,
      forecast: -7235,
    })

    await repository.saveMovement(markAsPaid(pending, '2026-10-28', pending.amountCents, NOW))
    const { movements } = await repository.loadAll()
    expect(movements).toHaveLength(1)
    expect(periodSummary(movements, monthPeriod(2026, 10))).toMatchObject({ expensePaid: 7235, expensePending: 0, forecast: -7235 })
  })

  it('abrir varias veces la aplicación no duplica vencimientos', async () => {
    const { repository, dbName } = openRepository()
    const rent = rule({ startDate: '2026-09-01' })
    expect(await repository.saveRecurring(rent, { horizon: HORIZON })).toBe(3) // 1 sep, 1 oct, 1 nov

    // Aperturas sucesivas, simultáneas (dos pestañas) y tras cerrar la app.
    expect(await repository.generateOccurrences(HORIZON)).toBe(0)
    expect(await repository.generateOccurrences(HORIZON)).toBe(0)
    const { repository: secondTab } = openRepository(dbName)
    expect(await Promise.all([repository.generateOccurrences(HORIZON), secondTab.generateOccurrences(HORIZON)])).toEqual([0, 0])
    await repository.close()
    const { repository: reopened } = openRepository(dbName)
    await reopened.generateOccurrences(HORIZON)

    const { movements } = await reopened.loadAll()
    expect(movements.map((m) => m.occurrenceDate).sort()).toEqual(['2026-09-01', '2026-10-01', '2026-11-01'])
  })

  it('dos pestañas que generan a la vez la primera vez tampoco duplican', async () => {
    const { repository, dbName } = openRepository()
    await repository.replaceAll({ ...(await repository.loadAll()), recurring: [rule({ startDate: '2026-10-05' })] })
    const { repository: secondTab } = openRepository(dbName)
    const created = await Promise.all([repository.generateOccurrences(HORIZON), secondTab.generateOccurrences(HORIZON)])
    expect(created.sort()).toEqual([0, 2])
    expect((await repository.loadAll()).movements).toHaveLength(2)
  })

  it('la base de datos rechaza un vencimiento duplicado', async () => {
    const { repository } = openRepository()
    const occurrence = { recurringId: 'r1', occurrenceDate: '2026-11-01', status: 'pendiente' as const, paidDate: null, dueDate: '2026-11-01' }
    await repository.saveMovement(movement(occurrence))
    await expect(repository.saveMovement(movement(occurrence))).rejects.toThrow()
    // Los movimientos normales no tienen esa restricción.
    await repository.saveMovement(movement())
    await repository.saveMovement(movement())
    expect((await repository.loadAll()).movements).toHaveLength(3)
  })

  it('pagar o eliminar un vencimiento no hace que se vuelva a generar', async () => {
    const { repository } = openRepository()
    const r = rule({ startDate: '2026-10-01' })
    await repository.saveRecurring(r, { horizon: HORIZON })
    const [october, november] = (await repository.loadAll()).movements.sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
    await repository.saveMovement(markAsPaid(october, '2026-10-01', october.amountCents, NOW))
    await repository.deleteMovement(november.id)
    expect(await repository.generateOccurrences(HORIZON)).toBe(0)

    const { movements, recurring } = await repository.loadAll()
    expect(movements.map((m) => [m.occurrenceDate, m.status])).toEqual([['2026-10-01', 'realizado']])
    expect(recurring[0].excludedDates).toEqual(['2026-11-01'])
  })

  it('al editar un recurrente se rehacen los pendientes y se conservan los pagados', async () => {
    const { repository } = openRepository()
    const gym = rule({ concept: 'Gimnasio', amountCents: 3000, startDate: '2026-10-01', categoryId: 'g-ocio' })
    await repository.saveRecurring(gym, { horizon: HORIZON })
    const october = (await repository.loadAll()).movements.find((m) => m.occurrenceDate === '2026-10-01')!
    await repository.saveMovement(markAsPaid(october, '2026-10-01', 3000, NOW))

    await repository.saveRecurring({ ...gym, amountCents: 3500 }, { horizon: HORIZON })
    const amounts = (await repository.loadAll()).movements
      .sort((a, b) => a.occurrenceDate!.localeCompare(b.occurrenceDate!))
      .map((m) => [m.occurrenceDate, m.status, m.amountCents])
    expect(amounts).toEqual([
      ['2026-10-01', 'realizado', 3000],
      ['2026-11-01', 'pendiente', 3500],
    ])
  })

  it('puede dar de alta un préstamo empezado con las cuotas pasadas ya pagadas', async () => {
    const { repository } = openRepository()
    const loan = rule({ concept: 'Préstamo coche', startDate: '2026-07-15', installments: 12, categoryId: 'g-prestamos' })
    await repository.saveRecurring(loan, { horizon: HORIZON, markPaidBefore: TODAY })
    const statuses = (await repository.loadAll()).movements
      .sort((a, b) => a.installmentNumber! - b.installmentNumber!)
      .map((m) => [m.installmentNumber, m.status])
    expect(statuses).toEqual([
      [1, 'realizado'],
      [2, 'realizado'],
      [3, 'realizado'],
      [4, 'realizado'],
      [5, 'pendiente'], // 15/11/2026
    ])
  })

  it('eliminar un recurrente borra sus pendientes y conserva lo pagado', async () => {
    const { repository } = openRepository()
    const r = rule({ startDate: '2026-10-01' })
    await repository.saveRecurring(r, { horizon: HORIZON, markPaidBefore: '2026-10-02' })
    await repository.deleteRecurring(r.id)
    const { movements, recurring } = await repository.loadAll()
    expect(recurring).toEqual([])
    expect(movements.map((m) => m.status)).toEqual(['realizado'])
  })

  it('al eliminar una categoría sus movimientos pasan a otra', async () => {
    const { repository } = openRepository()
    const light = movement({ categoryId: 'g-vivienda-luz' })
    await repository.saveMovement(light)
    await expect(repository.deleteCategory('g-vivienda', null)).rejects.toThrow()
    await repository.deleteCategory('g-vivienda', 'g-otros')
    const { movements, categories } = await repository.loadAll()
    expect(movements[0].categoryId).toBe('g-otros')
    expect(categories.some((c) => c.id.startsWith('g-vivienda'))).toBe(false)
  })

  it('exportar y restaurar una copia conserva los datos', async () => {
    const { repository } = openRepository()
    await repository.saveMovement(movement({ concept: 'Nómina', type: 'ingreso', categoryId: 'i-nomina', amountCents: 185000 }))
    await repository.saveMovement(movement({ notes: 'Notas con «comillas» y ; punto y coma' }))
    await repository.saveRecurring(rule({ startDate: '2026-10-01', installments: 6 }), { horizon: HORIZON })
    await repository.saveCategory({ ...DEFAULT_CATEGORIES.find((c) => c.id === 'g-alimentacion')!, budgetCents: 30000 })
    const original = await repository.loadAll()

    const parsed = parseBackup(serializeBackup(original, NOW))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    // Restaurar en otro "navegador" (otra base de datos) con datos distintos.
    const { repository: other } = openRepository()
    await other.saveMovement(movement({ concept: 'Se va a sustituir' }))
    await other.replaceAll(parsed.data)
    expect(await other.loadAll()).toEqual(original)
    expect(await other.generateOccurrences(HORIZON)).toBe(0)
  })
})
