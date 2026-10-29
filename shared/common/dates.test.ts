import { describe, expect, it } from 'vitest'
import {
  addMonthsClamped,
  daysBetween,
  describeDue,
  endOfNextMonth,
  formatDate,
  formatMonthYear,
  parseISODate,
  shiftMonth,
  todayISO,
} from './dates.ts'

describe('addMonthsClamped', () => {
  it.each([
    ['2026-01-31', 1, '2026-02-28'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-01-31', 2, '2026-03-31'],
    ['2026-08-31', 1, '2026-09-30'],
    ['2026-12-15', 1, '2027-01-15'],
    ['2024-02-29', 12, '2025-02-28'],
    ['2026-03-31', -1, '2026-02-28'],
  ])('%s + %i meses = %s', (start, months, expected) => {
    expect(addMonthsClamped(start, months)).toBe(expected)
  })
})

describe('fechas de calendario', () => {
  it('valida fechas reales', () => {
    expect(parseISODate('2026-02-29')).toBeNull()
    expect(parseISODate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 })
    expect(parseISODate('2026-13-01')).toBeNull()
    expect(parseISODate('05/10/2026')).toBeNull()
  })

  it('calcula el horizonte de generación', () => {
    expect(endOfNextMonth('2026-10-28')).toBe('2026-11-30')
    expect(endOfNextMonth('2026-12-05')).toBe('2027-01-31')
    expect(endOfNextMonth('2027-01-10')).toBe('2027-02-28')
  })

  it('cambia de mes y año', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
  })

  it('cuenta días y describe vencimientos', () => {
    expect(daysBetween('2026-10-28', '2026-11-02')).toBe(5)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2) // cambio de hora incluido
    expect(describeDue('2026-10-28', '2026-10-28')).toBe('Vence hoy')
    expect(describeDue('2026-10-29', '2026-10-28')).toBe('Vence mañana')
    expect(describeDue('2026-10-25', '2026-10-28')).toBe('Venció hace 3 días')
  })

  it('formatea en español', () => {
    expect(formatDate('2026-10-05')).toBe('05/10/2026')
    expect(formatMonthYear(2026, 10)).toBe('octubre de 2026')
  })

  it('usa la fecha local del dispositivo', () => {
    expect(todayISO(new Date(2026, 9, 28, 23, 59))).toBe('2026-10-28')
  })
})
