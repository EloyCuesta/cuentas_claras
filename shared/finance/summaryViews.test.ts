import { describe, expect, it } from 'vitest'
import { categoryMonthMatrix, monthlySeries } from './annual.ts'
import { DEFAULT_CATEGORIES } from './categories.ts'
import { monthPeriod, periodBounds, yearPeriod } from './period.ts'
import { generationHorizon, isProjected, projectOccurrences } from './recurring.ts'
import { budgetLines, categoryBreakdown, expensesByCategory, periodSummary } from './summary.ts'
import { forecastMovements, monthView, yearView } from './summaryViews.ts'
import { movement, rule } from '../testing/factories.ts'
import type { FinanceData } from './types.ts'

const TODAY = '2026-10-28'

function data(): FinanceData {
  return {
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    movements: [
      movement({ id: 'm-oct', amountCents: 5430, paidDate: '2026-10-12' }),
      movement({ id: 'm-nov', status: 'pendiente', paidDate: null, dueDate: '2026-11-03', amountCents: 2000 }),
      movement({ id: 'm-ing', type: 'ingreso', categoryId: 'i-nomina', amountCents: 185000, paidDate: '2026-10-01' }),
    ],
    recurring: [rule({ id: 'alquiler', startDate: '2026-09-01' })],
  }
}

describe('vistas del resumen (FIN-04)', () => {
  it('los movimientos de la previsión son los guardados y los proyectados después del horizonte', () => {
    const forecast = forecastMovements(data(), TODAY, '2027-01-31')
    expect(forecast.slice(0, 3).map((m) => m.id)).toEqual(['m-oct', 'm-nov', 'm-ing'])
    expect(forecast.slice(3).map((m) => [m.id, m.occurrenceDate])).toEqual([
      ['proyeccion:alquiler:2026-12-01', '2026-12-01'],
      ['proyeccion:alquiler:2027-01-01', '2027-01-01'],
    ])
    expect(forecast.slice(3).every(isProjected)).toBe(true)
    // Hasta el horizonte no se proyecta nada: esos vencimientos ya están creados.
    expect(forecastMovements(data(), TODAY, generationHorizon(TODAY))).toEqual(data().movements)
  })

  it('el mes es lo mismo que calculan las funciones del resumen por separado', () => {
    const view = monthView(data(), TODAY, 2026, 12)
    const period = monthPeriod(2026, 12)
    const movements = [...data().movements, ...projectOccurrences(data().recurring, data().movements, generationHorizon(TODAY), periodBounds(period).end)]
    expect(view).toEqual({
      period,
      horizon: '2026-11-30',
      summary: periodSummary(movements, period),
      expensesByCategory: expensesByCategory(movements, data().categories, period),
      budgetLines: budgetLines(movements, data().categories, period),
      breakdown: categoryBreakdown(movements, data().categories, period),
    })
    // Diciembre está después del horizonte: el alquiler cuenta como pendiente proyectado.
    expect(view.summary).toMatchObject({ expensePending: 65000, projectedExpenseCount: 1 })
  })

  it('una columna del año coincide con su mes', () => {
    const year = yearView(data(), TODAY, 2026)
    for (const month of [9, 10, 11, 12]) {
      expect(year.series[month - 1].summary).toEqual(monthView(data(), TODAY, 2026, month).summary)
    }
    const movements = forecastMovements(data(), TODAY, '2026-12-31')
    expect(year.series).toEqual(monthlySeries(movements, 2026))
    expect(year.expense).toEqual(categoryMonthMatrix(movements, data().categories, 2026, 'gasto'))
    expect(year.period).toEqual(yearPeriod(2026))
    expect(year.summary).toEqual(periodSummary(movements, yearPeriod(2026)))
  })
})
