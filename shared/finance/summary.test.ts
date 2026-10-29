import { describe, expect, it } from 'vitest'
import { categories, movement } from '../testing/factories.ts'
import { MONTHS } from './annual.ts'
import { monthPeriod, yearPeriod } from './period.ts'
import {
  budgetLines,
  categoryBreakdown,
  expensesByCategory,
  NO_SUBCATEGORY,
  pendingByDueDate,
  periodSummary,
  totalsByCategory,
} from './summary.ts'

const october = monthPeriod(2026, 10)

const data = [
  movement({ type: 'ingreso', categoryId: 'i-nomina', concept: 'Nómina', amountCents: 185000, paidDate: '2026-10-01' }),
  movement({ amountCents: 5430, paidDate: '2026-10-12' }), // supermercado
  movement({ amountCents: 1999, categoryId: 'g-alimentacion-comidas-fuera', paidDate: '2026-10-20' }),
  movement({ amountCents: 65000, categoryId: 'g-vivienda-alquiler', paidDate: '2026-10-02' }),
  movement({ status: 'pendiente', paidDate: null, dueDate: '2026-10-30', categoryId: 'g-vivienda-luz', amountCents: 7235 }),
  movement({ type: 'ingreso', status: 'pendiente', paidDate: null, dueDate: '2026-10-31', categoryId: 'i-extra', amountCents: 20000 }),
  // Vencía en septiembre pero se pagó en octubre: cuenta en octubre.
  movement({ status: 'realizado', dueDate: '2026-09-30', paidDate: '2026-10-03', categoryId: 'g-ocio', amountCents: 3000 }),
  // Otros meses: no cuentan.
  movement({ amountCents: 99999, paidDate: '2026-09-15' }),
  movement({ status: 'pendiente', paidDate: null, dueDate: '2026-11-01', amountCents: 88888 }),
  // Otro año.
  movement({ amountCents: 77777, paidDate: '2025-12-31' }),
]

describe('periodSummary', () => {
  it('separa lo real de lo previsto', () => {
    const s = periodSummary(data, october)
    expect(s.incomePaid).toBe(185000)
    expect(s.expensePaid).toBe(5430 + 1999 + 65000 + 3000)
    expect(s.realDifference).toBe(185000 - 75429)
    expect(s.expensePending).toBe(7235)
    expect(s.pendingExpenseCount).toBe(1)
    expect(s.incomePending).toBe(20000)
    expect(s.forecast).toBe(185000 + 20000 - 75429 - 7235)
    expect(s.projectedExpenseCount).toBe(0)
  })

  it('devuelve ceros en un mes sin movimientos', () => {
    expect(periodSummary(data, monthPeriod(2025, 1))).toMatchObject({ incomePaid: 0, expensePaid: 0, forecast: 0, movementCount: 0 })
  })

  it('el año es la suma de sus doce meses', () => {
    const year = periodSummary(data, yearPeriod(2026))
    const months = MONTHS.map((m) => periodSummary(data, monthPeriod(2026, m)))
    const sum = (key: 'incomePaid' | 'expensePaid' | 'incomePending' | 'expensePending' | 'forecast' | 'movementCount') =>
      months.reduce((total, s) => total + s[key], 0)
    expect(year.expensePaid).toBe(sum('expensePaid'))
    expect(year.expensePaid).toBe(75429 + 99999)
    expect(year.incomePaid).toBe(sum('incomePaid'))
    expect(year.incomePending).toBe(sum('incomePending'))
    expect(year.expensePending).toBe(sum('expensePending'))
    expect(year.forecast).toBe(sum('forecast'))
    expect(year.movementCount).toBe(data.length - 1)
  })

  it('cuenta aparte los vencimientos proyectados', () => {
    const projected = movement({ id: 'proyeccion:r1:2026-12-01', status: 'pendiente', paidDate: null, dueDate: '2026-12-01' })
    const s = periodSummary([...data, projected], yearPeriod(2026))
    expect(s.pendingExpenseCount).toBe(3)
    expect(s.projectedExpenseCount).toBe(1)
    expect(s.projectedIncomeCount).toBe(0)
  })
})

describe('expensesByCategory', () => {
  it('agrupa las subcategorías en su categoría principal', () => {
    const totals = expensesByCategory(data, categories(), october)
    expect(totals.map((t) => [t.name, t.paidCents, t.pendingCents])).toEqual([
      ['Vivienda', 65000, 7235],
      ['Alimentación', 7429, 0],
      ['Ocio', 3000, 0],
    ])
  })

  it('también agrupa los ingresos', () => {
    const totals = totalsByCategory(data, categories(), october, 'ingreso')
    expect(totals.map((t) => [t.name, t.paidCents, t.pendingCents])).toEqual([
      ['Nómina', 185000, 0],
      ['Ingresos extra', 0, 20000],
    ])
  })
})

describe('budgetLines', () => {
  const cats = categories().map((c) => (c.id === 'g-alimentacion' ? { ...c, budgetCents: 5000 } : c))

  it('calcula lo consumido y lo que queda', () => {
    const line = budgetLines(data, cats, october).find((l) => l.category.id === 'g-alimentacion')
    expect(line).toMatchObject({ budgetCents: 5000, spentCents: 7429, leftCents: 5000 - 7429 })
    const noBudget = budgetLines(data, cats, october).find((l) => l.category.id === 'g-ocio')
    expect(noBudget?.leftCents).toBeNull()
  })

  it('en el año multiplica el presupuesto mensual por doce', () => {
    const line = budgetLines(data, cats, yearPeriod(2026)).find((l) => l.category.id === 'g-alimentacion')
    expect(line).toMatchObject({ budgetCents: 60000, spentCents: 7429 + 99999 + 0, pendingCents: 88888 })
    expect(line?.leftCents).toBe(60000 - 107428)
  })
})

describe('categoryBreakdown', () => {
  const cats = categories().map((c) => (c.id === 'g-vivienda' ? { ...c, budgetCents: 80000 } : c))

  it('lista todas las principales en su orden con sus subcategorías usadas', () => {
    const { gasto, ingreso } = categoryBreakdown(data, cats, october)
    expect(gasto.groups.map((g) => g.name)).toEqual([
      'Vivienda',
      'Coche',
      'Alimentación',
      'Seguros',
      'Préstamos y letras',
      'Suscripciones',
      'Salud',
      'Ocio',
      'Otros',
    ])
    const vivienda = gasto.groups[0]
    expect(vivienda).toMatchObject({ paidCents: 65000, pendingCents: 7235, budgetCents: 80000, leftCents: 80000 - 72235 })
    expect(vivienda.children.map((c) => [c.name, c.paidCents, c.pendingCents])).toEqual([
      ['Alquiler o hipoteca', 65000, 0],
      ['Luz', 0, 7235],
    ])
    expect(gasto.groups[1]).toMatchObject({ name: 'Coche', paidCents: 0, pendingCents: 0, children: [] })
    expect(gasto).toMatchObject({ paidCents: 75429, pendingCents: 7235, budgetCents: 80000, leftCents: 80000 - 72235 })
    expect(ingreso.groups.map((g) => [g.name, g.paidCents, g.pendingCents])).toEqual([
      ['Nómina', 185000, 0],
      ['Ingresos extra', 0, 20000],
      ['Otros ingresos', 0, 0],
    ])
    expect(ingreso.budgetCents).toBeNull()
  })

  it('separa lo apuntado directamente en una principal con subcategorías', () => {
    const extra = movement({ categoryId: 'g-vivienda', amountCents: 1000, paidDate: '2026-10-05' })
    const vivienda = categoryBreakdown([...data, extra], cats, october).gasto.groups[0]
    expect(vivienda.paidCents).toBe(66000)
    expect(vivienda.children.at(-1)).toMatchObject({ name: NO_SUBCATEGORY, paidCents: 1000 })
  })

  it('pone al final los importes de categorías que ya no existen', () => {
    const lost = movement({ categoryId: 'g-borrada', amountCents: 500, paidDate: '2026-10-05' })
    const { gasto } = categoryBreakdown([...data, lost], cats, october)
    expect(gasto.groups.at(-1)).toMatchObject({ name: 'Sin categoría', paidCents: 500, budgetCents: null })
    expect(gasto.paidCents).toBe(75929)
  })
})

describe('pendingByDueDate', () => {
  it('pone primero los vencidos y ordena por fecha', () => {
    const { overdue, upcoming } = pendingByDueDate(data, '2026-10-31')
    expect(overdue.map((m) => m.dueDate)).toEqual(['2026-10-30'])
    expect(upcoming.map((m) => m.dueDate)).toEqual(['2026-10-31', '2026-11-01'])
  })
})
