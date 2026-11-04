import { formatMonthYear, isInMonth, monthBounds, shiftMonth, toISODate } from '../common/dates.ts'
import type { ISODate } from '../common/types.ts'

/**
 * Periodos de seguimiento: un mes o un año natural.
 *
 * Los cálculos del resumen reciben un periodo en lugar de año y mes sueltos,
 * así la misma lógica sirve para la plantilla mensual y para la anual.
 */

export interface YearMonth {
  year: number
  /** 1 = enero … 12 = diciembre */
  month: number
}

export type Period = { kind: 'mensual'; year: number; month: number } | { kind: 'anual'; year: number }

export function monthPeriod(year: number, month: number): Period {
  return { kind: 'mensual', year, month }
}

export function yearPeriod(year: number): Period {
  return { kind: 'anual', year }
}

/** Primer y último día del periodo. */
export function periodBounds(period: Period): { start: ISODate; end: ISODate } {
  if (period.kind === 'mensual') return monthBounds(period.year, period.month)
  return { start: toISODate(period.year, 1, 1), end: toISODate(period.year, 12, 31) }
}

export function isInPeriod(value: ISODate, period: Period): boolean {
  if (period.kind === 'mensual') return isInMonth(value, period.year, period.month)
  return value.startsWith(`${String(period.year).padStart(4, '0')}-`)
}

/** Periodo anterior (delta −1) o siguiente (delta 1), del mismo tipo. */
export function shiftPeriod(period: Period, delta: number): Period {
  if (period.kind === 'anual') return yearPeriod(period.year + delta)
  const target = shiftMonth(period.year, period.month, delta)
  return monthPeriod(target.year, target.month)
}

/** Meses que abarca el periodo (para escalar los presupuestos mensuales). */
export function monthsInPeriod(period: Period): number {
  return period.kind === 'mensual' ? 1 : 12
}

/** "octubre de 2026" o "2026" */
export function formatPeriod(period: Period): string {
  return period.kind === 'mensual' ? formatMonthYear(period.year, period.month) : String(period.year)
}

/** "mes" o "año", para frases como «Pagos pendientes del mes». */
export function periodUnit(period: Period): 'mes' | 'año' {
  return period.kind === 'mensual' ? 'mes' : 'año'
}
