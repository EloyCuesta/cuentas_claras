import { indexCategories, topLevelCategories } from './categories.ts'
import { sumCents } from './money.ts'
import { monthPeriod } from './period.ts'
import { periodSummary, totalsByCategory, type PeriodSummary } from './summary.ts'
import type { Category, Movement, MovementType } from './types.ts'

/**
 * Cálculos de la plantilla anual: el año mes a mes, en total y por categoría.
 * Cada mes se calcula con las mismas funciones que la plantilla mensual, así que
 * una columna del año coincide siempre con lo que se ve en ese mes.
 */

export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

export interface MonthPoint {
  month: number
  summary: PeriodSummary
  /** Diferencia real acumulada desde enero hasta este mes, incluido. */
  cumulativeReal: number
  /** Resultado previsto acumulado desde enero hasta este mes, incluido. */
  cumulativeForecast: number
}

export function monthlySeries(movements: readonly Movement[], year: number): MonthPoint[] {
  let real = 0
  let forecast = 0
  return MONTHS.map((month) => {
    const summary = periodSummary(movements, monthPeriod(year, month))
    real += summary.realDifference
    forecast += summary.forecast
    return { month, summary, cumulativeReal: real, cumulativeForecast: forecast }
  })
}

export interface MonthCell {
  paidCents: number
  pendingCents: number
}

export interface MatrixRow {
  categoryId: string
  name: string
  /** Una celda por mes, de enero a diciembre. */
  cells: MonthCell[]
  total: MonthCell
}

export interface CategoryMonthMatrix {
  type: MovementType
  rows: MatrixRow[]
  /** Total de cada mes (suma de todas las filas). */
  totals: MonthCell[]
  total: MonthCell
}

function sumCells(cells: readonly MonthCell[]): MonthCell {
  return { paidCents: sumCents(cells.map((c) => c.paidCents)), pendingCents: sumCents(cells.map((c) => c.pendingCents)) }
}

/**
 * Ingresos o gastos del año en una tabla: una fila por categoría principal (todas,
 * en su orden, aunque estén a cero) y una columna por mes.
 */
export function categoryMonthMatrix(
  movements: readonly Movement[],
  categories: readonly Category[],
  year: number,
  type: MovementType,
): CategoryMonthMatrix {
  const map = indexCategories(categories)
  const byMonth = MONTHS.map(
    (month) => new Map(totalsByCategory(movements, categories, monthPeriod(year, month), type).map((t) => [t.categoryId, t])),
  )
  // Las principales en su orden y, al final, las que ya no existen pero tienen importes.
  const ids = topLevelCategories(categories, type).map((c) => c.id)
  for (const totals of byMonth) {
    for (const id of totals.keys()) if (!map.has(id) && !ids.includes(id)) ids.push(id)
  }

  const rows = ids.map((id) => {
    const cells = byMonth.map((totals) => {
      const total = totals.get(id)
      return { paidCents: total?.paidCents ?? 0, pendingCents: total?.pendingCents ?? 0 }
    })
    return { categoryId: id, name: map.get(id)?.name ?? 'Sin categoría', cells, total: sumCells(cells) }
  })
  const totals = MONTHS.map((_, index) => sumCells(rows.map((row) => row.cells[index])))
  return { type, rows, totals, total: sumCells(totals) }
}
