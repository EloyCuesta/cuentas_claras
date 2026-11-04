import { afterEach, describe, expect, it } from 'vitest'
import { MAX_CENTS } from '#shared/common/money.ts'
import { parseBackup, serializeBackup } from '#shared/finance/backup.ts'
import { DEFAULT_CATEGORIES } from '#shared/finance/categories.ts'
import { monthPeriod } from '#shared/finance/period.ts'
import { generationHorizon } from '#shared/finance/recurring.ts'
import { periodSummary } from '#shared/finance/summary.ts'
import { markAsPaid } from '#shared/finance/validation.ts'
import type { ISODate } from '#shared/common/types.ts'
import type { MetaKey } from '#shared/finance/meta.ts'
import type { Category, FinanceData, Movement, RecurringRule, SaveRecurringOptions } from '#shared/finance/types.ts'
import { movement, NOW, rule } from '#shared/testing/factories.ts'
import { AppError } from '../../common/errors.ts'
import { MysqlUnitOfWork } from '../../common/mysql/MysqlUnitOfWork.ts'
import { randomIds, systemClock } from '../../common/system.ts'
import { createTestDatabase, dropTestDatabases, openTestDatabase } from '../../common/testing/testDatabase.ts'
import { createFinanceModule } from './index.ts'

/**
 * Los casos de uso de las finanzas contra una base MySQL de pruebas, con el
 * mismo contrato que src/features/finance/browserMigration/IndexedDbFinanceRepository.test.ts:
 * persistencia, totales al editar o eliminar, pagos sin duplicar, vencimientos
 * sin duplicar (también con dos conexiones a la vez) y copia de seguridad.
 */

/**
 * Los casos de uso con los nombres de siempre (los del contrato FinanceRepository
 * de la web): así las aserciones son las mismas que antes de repartir el
 * repositorio en casos de uso. Cada uno abre su propio pool, como otro proceso.
 */
async function openFinance(name: string) {
  const database = await openTestDatabase(name)
  const finance = createFinanceModule({
    db: database.db,
    clock: { ...systemClock, nowISO: () => NOW },
    ids: randomIds,
    unitOfWork: new MysqlUnitOfWork(database.db),
  })
  const { useCases } = finance
  return {
    loadAll: () => useCases.queries.loadAll(),
    saveMovement: (m: Movement) => useCases.saveMovement.execute(m),
    deleteMovement: (id: string) => useCases.deleteMovement.execute(id),
    saveCategory: (c: Category) => useCases.saveCategory.execute(c),
    deleteCategory: (id: string, replacementId: string | null) => useCases.deleteCategory.execute(id, replacementId),
    saveRecurring: (r: RecurringRule, options: SaveRecurringOptions) => useCases.saveRecurring.execute(r, options),
    deleteRecurring: (id: string) => useCases.deleteRecurring.execute(id),
    generateOccurrences: (horizon: ISODate) => useCases.generateOccurrences.execute(horizon),
    replaceAll: (data: FinanceData) => useCases.restoreBackup.execute(data),
    getMeta: (key: MetaKey) => useCases.queries.getMeta(key),
    setMeta: (key: MetaKey, value: string) => useCases.setMeta.execute(key, value),
    importBrowserData: (data: FinanceData, lastBackupAt: string | null) => useCases.importBrowserData.execute(data, lastBackupAt),
    reset: () => finance.reset(),
    /** Cierra sus conexiones (para simular cerrar la app); la base se queda. */
    close: () => database.db.close(),
  }
}

/** Abre las finanzas sobre una base nueva o, con `name`, sobre la de otro repositorio («volver a abrir»). */
async function openRepository(name?: string) {
  const database = name ?? (await createTestDatabase())
  return { repository: await openFinance(database), name: database }
}

afterEach(async () => {
  await dropTestDatabases()
})

const TODAY = '2026-10-28'
const HORIZON = generationHorizon(TODAY) // 30/11/2026

describe('finanzas en MySQL', () => {
  it('empieza sin movimientos y con las categorías iniciales', async () => {
    const { repository } = await openRepository()
    const data = await repository.loadAll()
    expect(data.movements).toEqual([])
    expect(data.recurring).toEqual([])
    expect(data.categories).toHaveLength(DEFAULT_CATEGORIES.length)
  })

  it('los movimientos se conservan después de cerrar y volver a abrir', async () => {
    const { repository, name } = await openRepository()
    const saved = movement({ concept: 'Mercadona', amountCents: 4520 })
    await repository.saveMovement(saved)
    await repository.close()

    const { repository: reopened } = await openRepository(name)
    expect((await reopened.loadAll()).movements).toEqual([saved])
  })

  it('las categorías iniciales no reaparecen al volver a abrir', async () => {
    const { repository, name } = await openRepository()
    await repository.deleteCategory('g-ocio', null)
    await repository.close()
    const { repository: reopened } = await openRepository(name)
    const ids = (await reopened.loadAll()).categories.map((c) => c.id)
    expect(ids).not.toContain('g-ocio')
  })

  it('editar o eliminar un movimiento actualiza los totales', async () => {
    const { repository } = await openRepository()
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
    const { repository } = await openRepository()
    const pending = movement({ status: 'pendiente', paidDate: null, dueDate: '2026-10-30', amountCents: 7235 })
    await repository.saveMovement(pending)
    await repository.saveMovement(markAsPaid(pending, '2026-10-28', pending.amountCents, NOW))
    const { movements } = await repository.loadAll()
    expect(movements).toHaveLength(1)
    expect(periodSummary(movements, monthPeriod(2026, 10))).toMatchObject({ expensePaid: 7235, expensePending: 0, forecast: -7235 })
  })

  it('abrir varias veces la aplicación no duplica vencimientos', async () => {
    const { repository, name } = await openRepository()
    const rent = rule({ startDate: '2026-09-01' })
    expect(await repository.saveRecurring(rent, { horizon: HORIZON })).toBe(3) // 1 sep, 1 oct, 1 nov

    // Aperturas sucesivas, simultáneas (dos conexiones) y tras cerrar la app.
    expect(await repository.generateOccurrences(HORIZON)).toBe(0)
    const { repository: secondTab } = await openRepository(name)
    expect(await Promise.all([repository.generateOccurrences(HORIZON), secondTab.generateOccurrences(HORIZON)])).toEqual([0, 0])
    await repository.close()
    const { repository: reopened } = await openRepository(name)
    await reopened.generateOccurrences(HORIZON)

    const { movements } = await reopened.loadAll()
    expect(movements.map((m) => m.occurrenceDate).sort()).toEqual(['2026-09-01', '2026-10-01', '2026-11-01'])
  })

  it('dos conexiones que generan a la vez la primera vez tampoco duplican', async () => {
    const { repository, name } = await openRepository()
    await repository.replaceAll({ ...(await repository.loadAll()), recurring: [rule({ startDate: '2026-10-05' })] })
    const { repository: secondTab } = await openRepository(name)
    const created = await Promise.all([repository.generateOccurrences(HORIZON), secondTab.generateOccurrences(HORIZON)])
    expect(created.sort()).toEqual([0, 2])
    expect((await repository.loadAll()).movements).toHaveLength(2)
  })

  it('con dos conexiones, guardar un recurrente y generar a la vez no duplica ni da 409', async () => {
    const { repository, name } = await openRepository()
    const r = rule({ startDate: '2026-10-05' })
    await repository.replaceAll({ ...(await repository.loadAll()), recurring: [r] })
    const { repository: secondTab } = await openRepository(name)
    // Con el bloqueo «finance» van en serie: o genera y después se rehacen los pendientes, o al revés.
    const [created, generated] = await Promise.all([repository.saveRecurring({ ...r, amountCents: 70000 }, { horizon: HORIZON }), secondTab.generateOccurrences(HORIZON)])
    expect(created).toBe(2)
    expect([0, 2]).toContain(generated)
    const { movements } = await repository.loadAll()
    expect(movements.map((m) => [m.occurrenceDate, m.amountCents]).sort()).toEqual([
      ['2026-10-05', 70000],
      ['2026-11-05', 70000],
    ])
  })

  it('un movimiento que pasaría a ser un vencimiento que ya existe da 409 y no pisa ninguno de los dos', async () => {
    const { repository } = await openRepository()
    const pending = { recurringId: 'r1', status: 'pendiente' as const, paidDate: null }
    const november = movement({ ...pending, occurrenceDate: '2026-11-01', dueDate: '2026-11-01' })
    const december = movement({ ...pending, occurrenceDate: '2026-12-01', dueDate: '2026-12-01' })
    await repository.saveMovement(november)
    await repository.saveMovement(december)
    // Se actualiza por id: el índice único (recurrente + fecha) falla en vez de sobrescribir el de noviembre.
    await expect(repository.saveMovement({ ...december, occurrenceDate: '2026-11-01', concept: 'Choca' })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Ese vencimiento ya existe, así que no se ha creado otro.',
    })
    const byId = (a: Movement, b: Movement) => a.id.localeCompare(b.id)
    expect((await repository.loadAll()).movements.sort(byId)).toEqual([november, december].sort(byId))
  })

  it('guarda los céntimos exactos, del más pequeño al máximo, y los presupuestos y el orden tal cual', async () => {
    const { repository } = await openRepository()
    const largest = movement({ amountCents: MAX_CENTS, concept: 'Máximo' })
    const smallest = movement({ amountCents: 1, concept: 'Un céntimo' })
    await repository.saveMovement(largest)
    await repository.saveMovement(smallest)
    const food = DEFAULT_CATEGORIES.find((c) => c.id === 'g-alimentacion')!
    await repository.saveCategory({ ...food, budgetCents: MAX_CENTS, order: 2.5 })
    const data = await repository.loadAll()
    expect(data.movements.map((m) => [m.concept, m.amountCents]).sort()).toEqual([
      ['Máximo', 99_999_999_999],
      ['Un céntimo', 1],
    ])
    expect(data.categories.find((c) => c.id === food.id)).toEqual({ ...food, budgetCents: MAX_CENTS, order: 2.5 })
  })

  it('los ids distinguen mayúsculas, tildes y espacios finales, y se ordenan como en SQLite', async () => {
    const { repository } = await openRepository()
    // Con utf8mb4_0900_ai_ci los cuatro serían el mismo id, y con utf8mb4_bin «mov-a» y «mov-a » chocarían.
    const ids = ['mov-a', 'MOV-A', 'mov-á', 'mov-a ']
    for (const [i, id] of ids.entries()) await repository.saveMovement(movement({ id, amountCents: 100 + i }))
    // Por punto de código, como comparaba SQLite los bytes UTF-8.
    expect((await repository.loadAll()).movements.map((m) => [m.id, m.amountCents])).toEqual([
      ['MOV-A', 101],
      ['mov-a', 100],
      ['mov-a ', 103],
      ['mov-á', 102],
    ])
    await repository.deleteMovement('mov-a ')
    expect((await repository.loadAll()).movements.map((m) => m.id)).toEqual(['MOV-A', 'mov-a', 'mov-á'])
  })

  it('la base de datos rechaza un vencimiento duplicado', async () => {
    const { repository } = await openRepository()
    const occurrence = { recurringId: 'r1', occurrenceDate: '2026-11-01', status: 'pendiente' as const, paidDate: null, dueDate: '2026-11-01' }
    await repository.saveMovement(movement(occurrence))
    await expect(repository.saveMovement(movement(occurrence))).rejects.toMatchObject({ code: 'CONFLICT' })
    // Los movimientos normales no tienen esa restricción.
    await repository.saveMovement(movement())
    await repository.saveMovement(movement())
    expect((await repository.loadAll()).movements).toHaveLength(3)
  })

  it('pagar o eliminar un vencimiento no hace que se vuelva a generar', async () => {
    const { repository } = await openRepository()
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
    const { repository } = await openRepository()
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
    const { repository } = await openRepository()
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
    const { repository } = await openRepository()
    const r = rule({ startDate: '2026-10-01', excludedDates: ['2027-01-01'] })
    await repository.saveRecurring(r, { horizon: HORIZON, markPaidBefore: '2026-10-02' })
    await repository.deleteRecurring(r.id)
    const { movements, recurring } = await repository.loadAll()
    expect(recurring).toEqual([])
    // El vencimiento pagado se queda, con su recurringId aunque el recurrente ya no exista.
    expect(movements.map((m) => [m.status, m.recurringId])).toEqual([['realizado', r.id]])
  })

  it('al eliminar una categoría sus movimientos pasan a otra', async () => {
    const { repository } = await openRepository()
    const light = movement({ categoryId: 'g-vivienda-luz' })
    await repository.saveMovement(light)
    await expect(repository.deleteCategory('g-vivienda', null)).rejects.toThrow()
    await expect(repository.deleteCategory('g-vivienda', 'i-nomina')).rejects.toMatchObject({ code: 'VALIDATION' })
    await repository.deleteCategory('g-vivienda', 'g-otros')
    const { movements, categories } = await repository.loadAll()
    expect(movements[0].categoryId).toBe('g-otros')
    expect(categories.some((c) => c.id.startsWith('g-vivienda'))).toBe(false)
  })

  it('exportar y restaurar una copia conserva los datos', async () => {
    const { repository } = await openRepository()
    await repository.saveMovement(movement({ concept: 'Nómina', type: 'ingreso', categoryId: 'i-nomina', amountCents: 185000 }))
    await repository.saveMovement(movement({ notes: 'Notas con «comillas» y ; punto y coma' }))
    await repository.saveRecurring(rule({ startDate: '2026-10-01', installments: 6, excludedDates: ['2026-12-01'] }), { horizon: HORIZON })
    await repository.saveCategory({ ...DEFAULT_CATEGORIES.find((c) => c.id === 'g-alimentacion')!, budgetCents: 30000 })
    const original = await repository.loadAll()

    const parsed = parseBackup(serializeBackup(original, NOW))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    // Restaurar en otra base de datos con datos distintos.
    const { repository: other } = await openRepository()
    await other.saveMovement(movement({ concept: 'Se va a sustituir' }))
    await other.replaceAll(parsed.data)
    expect(await other.loadAll()).toEqual(original)
    expect(await other.generateOccurrences(HORIZON)).toBe(0)
  })
})

describe('integridad de los datos', () => {
  it('rechaza movimientos con una categoría que no existe o de otro tipo', async () => {
    const { repository } = await openRepository()
    await expect(repository.saveMovement(movement({ categoryId: 'no-existe' }))).rejects.toBeInstanceOf(AppError)
    await expect(repository.saveMovement(movement({ categoryId: 'i-nomina' }))).rejects.toMatchObject({ code: 'VALIDATION' })
    expect((await repository.loadAll()).movements).toEqual([])
  })

  it('solo permite un nivel de subcategorías del mismo tipo', async () => {
    const { repository } = await openRepository()
    const sub = { id: 'g-luz-verde', name: 'Luz verde', type: 'gasto' as const, parentId: 'g-vivienda-luz', order: 0, budgetCents: null }
    await expect(repository.saveCategory(sub)).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(repository.saveCategory({ ...sub, parentId: 'i-nomina' })).rejects.toMatchObject({ code: 'VALIDATION' })
    await repository.saveCategory({ ...sub, parentId: 'g-vivienda' })
    expect((await repository.loadAll()).categories.find((c) => c.id === sub.id)?.parentId).toBe('g-vivienda')
  })

  it('una restauración que falla a medias no cambia nada', async () => {
    const { repository } = await openRepository()
    const kept = movement({ concept: 'Se conserva' })
    await repository.saveMovement(kept)
    const before = await repository.loadAll()
    // Un movimiento con una categoría inexistente hace fallar la clave foránea dentro de la transacción.
    await expect(repository.replaceAll({ ...before, movements: [movement({ categoryId: 'no-existe' })] })).rejects.toThrow()
    expect(await repository.loadAll()).toEqual(before)
  })
})

describe('importación de los datos del navegador', () => {
  const browserData = () => ({
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    movements: [movement({ concept: 'Del navegador' })],
    recurring: [rule({ startDate: '2026-10-01' })],
  })

  it('importa si la base de datos no tiene datos del usuario y lo anota', async () => {
    const { repository } = await openRepository()
    const data = browserData()
    expect(await repository.importBrowserData(data, '2026-10-01T10:00:00.000Z')).toEqual({
      categories: DEFAULT_CATEGORIES.length,
      movements: 1,
      recurring: 1,
    })
    expect((await repository.loadAll()).movements.map((m) => m.concept)).toEqual(['Del navegador'])
    expect(await repository.getMeta('lastBackupAt')).toBe('2026-10-01T10:00:00.000Z')
    expect(await repository.getMeta('browserImportAt')).toBe(NOW)
  })

  it('no importa nada si ya hay datos: nunca mezcla ni duplica', async () => {
    const { repository } = await openRepository()
    await repository.saveMovement(movement({ concept: 'Ya estaba' }))
    await expect(repository.importBrowserData(browserData(), null)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect((await repository.loadAll()).movements.map((m) => m.concept)).toEqual(['Ya estaba'])
    expect(await repository.getMeta('browserImportAt')).toBeNull()
  })

  it('reset deja la base de datos como nueva', async () => {
    const { repository } = await openRepository()
    await repository.importBrowserData(browserData(), null)
    await repository.reset()
    const data = await repository.loadAll()
    expect([data.movements, data.recurring]).toEqual([[], []])
    expect(data.categories).toHaveLength(DEFAULT_CATEGORIES.length)
    expect(await repository.getMeta('browserImportAt')).toBeNull()
  })
})
