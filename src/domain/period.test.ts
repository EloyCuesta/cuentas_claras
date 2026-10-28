import { describe, expect, it } from 'vitest'
import { shortMonthName } from './dates.ts'
import {
  formatPeriod,
  isInPeriod,
  monthPeriod,
  monthsInPeriod,
  periodBounds,
  periodUnit,
  shiftPeriod,
  yearPeriod,
} from './period.ts'

describe('periodos', () => {
  it('calcula el primer y el último día', () => {
    expect(periodBounds(monthPeriod(2028, 2))).toEqual({ start: '2028-02-01', end: '2028-02-29' })
    expect(periodBounds(yearPeriod(2026))).toEqual({ start: '2026-01-01', end: '2026-12-31' })
  })

  it('sabe si una fecha está dentro', () => {
    expect(isInPeriod('2026-10-31', monthPeriod(2026, 10))).toBe(true)
    expect(isInPeriod('2026-11-01', monthPeriod(2026, 10))).toBe(false)
    expect(isInPeriod('2026-01-01', yearPeriod(2026))).toBe(true)
    expect(isInPeriod('2026-12-31', yearPeriod(2026))).toBe(true)
    expect(isInPeriod('2027-01-01', yearPeriod(2026))).toBe(false)
    expect(isInPeriod('', yearPeriod(2026))).toBe(false)
  })

  it('avanza y retrocede cambiando de año', () => {
    expect(shiftPeriod(monthPeriod(2026, 12), 1)).toEqual(monthPeriod(2027, 1))
    expect(shiftPeriod(monthPeriod(2026, 1), -1)).toEqual(monthPeriod(2025, 12))
    expect(shiftPeriod(yearPeriod(2026), -1)).toEqual(yearPeriod(2025))
  })

  it('da los textos y los meses de cada tipo', () => {
    expect(formatPeriod(monthPeriod(2026, 10))).toBe('octubre de 2026')
    expect(formatPeriod(yearPeriod(2026))).toBe('2026')
    expect(periodUnit(monthPeriod(2026, 10))).toBe('mes')
    expect(periodUnit(yearPeriod(2026))).toBe('año')
    expect(monthsInPeriod(monthPeriod(2026, 10))).toBe(1)
    expect(monthsInPeriod(yearPeriod(2026))).toBe(12)
    expect(shortMonthName(1)).toBe('ene')
    expect(shortMonthName(9)).toBe('sep')
  })
})
