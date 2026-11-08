import { categoryMonthMatrix, monthlySeries, type CategoryMonthMatrix, type MonthPoint } from './annual.ts'
import { monthPeriod, periodBounds, yearPeriod, type Period } from './period.ts'
import { generationHorizon, projectOccurrences } from './recurring.ts'
import {
  budgetLines,
  categoryBreakdown,
  expensesByCategory,
  periodSummary,
  type BudgetLine,
  type CategoryBreakdown,
  type CategoryTotal,
  type PeriodSummary,
} from './summary.ts'
import type { ISODate } from '../common/types.ts'
import type { FinanceData, Movement } from './types.ts'

/**
 * Lo que enseñan las plantillas mensual y anual, calculado de una vez (FIN-04). Lo usan las páginas cuando calculan
 * en el navegador y es lo que devuelven las consultas de .NET (GET /api/summary/month y /api/summary/year), así que
 * las dos formas dan lo mismo: lo comprueba el corpus fixtures/migration/rules-finance.json.
 *
 * Lo realizado cuenta en el mes de su fecha de pago, lo pendiente en el de su vencimiento, y los vencimientos que
 * tendrán los recurrentes después del horizonte (el final del mes siguiente a hoy) se proyectan sin guardarse.
 */

/** Los movimientos guardados más los vencimientos proyectados de los recurrentes hasta `until`. */
export function forecastMovements(data: FinanceData, today: ISODate, until: ISODate): Movement[] {
  const projected = projectOccurrences(data.recurring, data.movements, generationHorizon(today), until)
  return projected.length > 0 ? [...data.movements, ...projected] : data.movements
}

export interface MonthView {
  period: Period
  /** Hasta dónde están creados los vencimientos; lo posterior es proyectado. */
  horizon: ISODate
  summary: PeriodSummary
  expensesByCategory: CategoryTotal[]
  budgetLines: BudgetLine[]
  breakdown: CategoryBreakdown
}

export interface YearView {
  period: Period
  horizon: ISODate
  summary: PeriodSummary
  series: MonthPoint[]
  income: CategoryMonthMatrix
  expense: CategoryMonthMatrix
  budgetLines: BudgetLine[]
}

/** El mes: la cuenta, los gastos por categoría, los presupuestos y el detalle por categoría y subcategoría. */
export function monthView(data: FinanceData, today: ISODate, year: number, month: number): MonthView {
  const period = monthPeriod(year, month)
  const movements = forecastMovements(data, today, periodBounds(period).end)
  return {
    period,
    horizon: generationHorizon(today),
    summary: periodSummary(movements, period),
    expensesByCategory: expensesByCategory(movements, data.categories, period),
    budgetLines: budgetLines(movements, data.categories, period),
    breakdown: categoryBreakdown(movements, data.categories, period),
  }
}

/** El año: la cuenta, la evolución mes a mes, las categorías por meses y el presupuesto anual. */
export function yearView(data: FinanceData, today: ISODate, year: number): YearView {
  const period = yearPeriod(year)
  const movements = forecastMovements(data, today, periodBounds(period).end)
  return {
    period,
    horizon: generationHorizon(today),
    summary: periodSummary(movements, period),
    series: monthlySeries(movements, year),
    income: categoryMonthMatrix(movements, data.categories, year, 'ingreso'),
    expense: categoryMonthMatrix(movements, data.categories, year, 'gasto'),
    budgetLines: budgetLines(movements, data.categories, period),
  }
}
