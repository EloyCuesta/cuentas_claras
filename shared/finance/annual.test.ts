import { describe, expect, it } from 'vitest'
import { categories, movement } from '../testing/factories.ts'
import { categoryMonthMatrix, monthlySeries } from './annual.ts'
import { yearPeriod } from './period.ts'
import { periodSummary, totalsByCategory } from './summary.ts'

const data = [
  movement({ type: 'ingreso', categoryId: 'i-nomina', amountCents: 185000, paidDate: '2026-01-30' }),
  movement({ amountCents: 65000, categoryId: 'g-vivienda-alquiler', paidDate: '2026-01-02' }),
  movement({ amountCents: 5430, paidDate: '2026-03-12' }),
  movement({ type: 'ingreso', categoryId: 'i-nomina', amountCents: 185000, paidDate: '2026-03-30' }),
  movement({ status: 'pendiente', paidDate: null, dueDate: '2026-12-01', categoryId: 'g-vivienda-alquiler', amountCents: 65000 }),
  movement({ amountCents: 1000, paidDate: '2027-01-01' }),
]

describe('monthlySeries', () => {
  it('da los doce meses con su acumulado', () => {
    const series = monthlySeries(data, 2026)
    expect(series).toHaveLength(12)
    expect(series.map((p) => p.summary.realDifference)).toEqual([120000, 0, 179570, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(series[2].cumulativeReal).toBe(299570)
    expect(series[11].cumulativeReal).toBe(299570)
    expect(series[11].summary.expensePending).toBe(65000)
    expect(series[11].cumulativeForecast).toBe(299570 - 65000)
    expect(series[11].cumulativeForecast).toBe(periodSummary(data, yearPeriod(2026)).forecast)
  })
})

describe('categoryMonthMatrix', () => {
  it('reparte cada categoría principal por meses y cuadra con el total del año', () => {
    const matrix = categoryMonthMatrix(data, categories(), 2026, 'gasto')
    expect(matrix.rows).toHaveLength(9)
    const vivienda = matrix.rows.find((r) => r.name === 'Vivienda')
    expect(vivienda?.cells[0]).toEqual({ paidCents: 65000, pendingCents: 0 })
    expect(vivienda?.cells[11]).toEqual({ paidCents: 0, pendingCents: 65000 })
    expect(vivienda?.total).toEqual({ paidCents: 65000, pendingCents: 65000 })
    expect(matrix.totals[2]).toEqual({ paidCents: 5430, pendingCents: 0 })

    const yearTotals = totalsByCategory(data, categories(), yearPeriod(2026), 'gasto')
    for (const total of yearTotals) {
      const row = matrix.rows.find((r) => r.categoryId === total.categoryId)
      expect(row?.total).toEqual({ paidCents: total.paidCents, pendingCents: total.pendingCents })
    }
    expect(matrix.total).toEqual({ paidCents: 70430, pendingCents: 65000 })
  })

  it('incluye las filas de ingresos aunque estén a cero', () => {
    const matrix = categoryMonthMatrix(data, categories(), 2026, 'ingreso')
    expect(matrix.rows.map((r) => [r.name, r.total.paidCents])).toEqual([
      ['Nómina', 370000],
      ['Ingresos extra', 0],
      ['Otros ingresos', 0],
    ])
  })
})
