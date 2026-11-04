import { describe, expect, it } from 'vitest'
import { movement, NOW, rule, testId } from '../testing/factories.ts'
import {
  generationHorizon,
  isProjected,
  pastDates,
  planOccurrences,
  projectOccurrences,
  recurringStatus,
  scheduleDates,
} from './recurring.ts'

describe('scheduleDates', () => {
  it('usa el último día del mes cuando el día 31 no existe', () => {
    const r = rule({ startDate: '2026-01-31' })
    expect(scheduleDates(r, '2026-06-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ])
  })

  it('respeta la frecuencia', () => {
    const start = '2026-01-15'
    expect(scheduleDates(rule({ startDate: start, frequency: 'trimestral' }), '2026-12-31')).toEqual([
      '2026-01-15',
      '2026-04-15',
      '2026-07-15',
      '2026-10-15',
    ])
    expect(scheduleDates(rule({ startDate: start, frequency: 'semestral' }), '2027-12-31')).toEqual([
      '2026-01-15',
      '2026-07-15',
      '2027-01-15',
      '2027-07-15',
    ])
    expect(scheduleDates(rule({ startDate: '2024-02-29', frequency: 'anual' }), '2028-12-31')).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ])
  })

  it('se detiene en el número de cuotas o en la fecha de fin', () => {
    expect(scheduleDates(rule({ startDate: '2026-01-05', installments: 3 }), '2030-01-01')).toHaveLength(3)
    expect(scheduleDates(rule({ startDate: '2026-01-05', endDate: '2026-03-04' }), '2030-01-01')).toEqual([
      '2026-01-05',
      '2026-02-05',
    ])
  })
})

describe('planOccurrences', () => {
  const horizon = generationHorizon('2026-10-28') // 30/11/2026

  it('crea los vencimientos pendientes hasta el horizonte', () => {
    const r = rule({ startDate: '2026-09-01' })
    const planned = planOccurrences(r, [], horizon, NOW, () => testId())
    expect(planned.map((m) => m.dueDate)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01'])
    expect(planned.every((m) => m.status === 'pendiente' && m.recurringId === r.id)).toBe(true)
  })

  it('no duplica vencimientos que ya existen (aunque estén pagados)', () => {
    const r = rule({ startDate: '2026-09-01' })
    const first = planOccurrences(r, [], horizon, NOW, () => testId())
    first[0] = { ...first[0], status: 'realizado', paidDate: '2026-09-02' }
    expect(planOccurrences(r, first, horizon, NOW, () => testId())).toEqual([])
  })

  it('no vuelve a crear los vencimientos eliminados', () => {
    const r = rule({ startDate: '2026-09-01', excludedDates: ['2026-10-01'] })
    const planned = planOccurrences(r, [], horizon, NOW, () => testId())
    expect(planned.map((m) => m.occurrenceDate)).toEqual(['2026-09-01', '2026-11-01'])
  })

  it('numera las cuotas de los préstamos', () => {
    const r = rule({ startDate: '2026-10-10', installments: 24 })
    const planned = planOccurrences(r, [], horizon, NOW, () => testId())
    expect(planned.map((m) => m.installmentNumber)).toEqual([1, 2])
  })
})

describe('projectOccurrences', () => {
  const horizon = generationHorizon('2026-10-28') // 30/11/2026

  it('proyecta solo lo que queda después del horizonte, sin duplicar lo creado', () => {
    const r = rule({ startDate: '2026-09-01' })
    const created = planOccurrences(r, [], horizon, NOW, () => testId())
    const projected = projectOccurrences([r], created, horizon, '2027-02-28')
    expect(projected.map((m) => m.dueDate)).toEqual(['2026-12-01', '2027-01-01', '2027-02-01'])
    expect(projected.every((m) => m.status === 'pendiente' && m.recurringId === r.id && isProjected(m))).toBe(true)
    expect(created.some(isProjected)).toBe(false)
  })

  it('respeta los vencimientos eliminados, la fecha de fin y las cuotas', () => {
    const excluded = rule({ startDate: '2026-09-01', excludedDates: ['2027-01-01'] })
    const ending = rule({ startDate: '2026-09-15', endDate: '2027-01-14' })
    const loan = rule({ startDate: '2026-10-10', installments: 3 })
    const projected = projectOccurrences([excluded, ending, loan], [], horizon, '2027-12-31')
    const datesOf = (id: string) => projected.filter((m) => m.recurringId === id).map((m) => m.dueDate)
    expect(datesOf(excluded.id).slice(0, 2)).toEqual(['2026-12-01', '2027-02-01'])
    expect(datesOf(ending.id)).toEqual(['2026-12-15'])
    expect(projected.filter((m) => m.recurringId === loan.id).map((m) => [m.dueDate, m.installmentNumber])).toEqual([
      ['2026-12-10', 3],
    ])
  })

  it('da ids estables y nada si el límite no pasa del horizonte', () => {
    const r = rule({ startDate: '2026-09-01' })
    const first = projectOccurrences([r], [], horizon, '2026-12-31')
    expect(first.map((m) => m.id)).toEqual([`proyeccion:${r.id}:2026-12-01`])
    expect(projectOccurrences([r], [], horizon, '2026-12-31')).toEqual(first)
    expect(projectOccurrences([r], [], horizon, horizon)).toEqual([])
  })
})

describe('recurringStatus', () => {
  it('cuenta las cuotas pagadas y las que quedan', () => {
    const r = rule({ startDate: '2026-08-10', installments: 12, concept: 'Préstamo coche' })
    const occurrences = planOccurrences(r, [], '2026-11-30', NOW, () => testId())
    const paid = occurrences.map((m, i) => (i < 2 ? { ...m, status: 'realizado' as const, paidDate: m.dueDate } : m))
    const status = recurringStatus(r, paid, '2026-10-28')
    expect(status).toMatchObject({ total: 12, paid: 2, remaining: 10, nextDate: '2026-10-10', finished: false })
  })

  it('marca como terminado cuando se han pagado todas', () => {
    const r = rule({ startDate: '2026-01-10', installments: 2 })
    const all = planOccurrences(r, [], '2026-11-30', NOW, () => testId()).map((m) => ({
      ...m,
      status: 'realizado' as const,
      paidDate: m.dueDate,
    }))
    expect(recurringStatus(r, all, '2026-10-28')).toMatchObject({ remaining: 0, finished: true, nextDate: null })
  })

  it('sin final no calcula cuotas restantes', () => {
    const r = rule({ startDate: '2026-11-01' })
    const status = recurringStatus(r, [movement()], '2026-10-28')
    expect(status).toMatchObject({ total: null, remaining: null, nextDate: '2026-11-01' })
  })

  it('lista los vencimientos anteriores a hoy', () => {
    expect(pastDates(rule({ startDate: '2026-08-28' }), '2026-10-28')).toEqual(['2026-08-28', '2026-09-28'])
  })
})
