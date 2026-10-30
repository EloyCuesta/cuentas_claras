import { describe, expect, it } from 'vitest'
import { categories, movement, NOW } from '../test/factories.ts'
import {
  markAsPaid,
  validateCategoryName,
  validateMovementDraft,
  validateRecurringDraft,
  type MovementDraft,
  type RecurringDraft,
} from './validation.ts'

const draft = (overrides: Partial<MovementDraft> = {}): MovementDraft => ({
  type: 'gasto',
  amount: '12,50',
  concept: 'Pan',
  categoryId: 'g-alimentacion-supermercado',
  status: 'realizado',
  paidDate: '2026-10-28',
  dueDate: '',
  notes: '',
  ...overrides,
})

describe('validateMovementDraft', () => {
  it('acepta un gasto pagado y lo convierte a céntimos', () => {
    const result = validateMovementDraft(draft(), categories())
    expect(result).toEqual({
      ok: true,
      value: {
        type: 'gasto',
        amountCents: 1250,
        concept: 'Pan',
        categoryId: 'g-alimentacion-supermercado',
        status: 'realizado',
        paidDate: '2026-10-28',
        dueDate: null,
        notes: '',
      },
    })
  })

  it('marca los campos obligatorios', () => {
    const result = validateMovementDraft(draft({ amount: '', concept: ' ', categoryId: '', paidDate: '' }), categories())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['amount', 'categoryId', 'concept', 'paidDate'])
  })

  it('pide fecha prevista a los pendientes y descarta la de pago', () => {
    const missing = validateMovementDraft(draft({ status: 'pendiente' }), categories())
    expect(missing.ok).toBe(false)
    const ok = validateMovementDraft(draft({ status: 'pendiente', dueDate: '2026-11-05' }), categories())
    expect(ok.ok && ok.value).toMatchObject({ paidDate: null, dueDate: '2026-11-05' })
  })

  it('no permite una categoría de ingresos en un gasto', () => {
    const result = validateMovementDraft(draft({ categoryId: 'i-nomina' }), categories())
    expect(result.ok).toBe(false)
  })
})

describe('markAsPaid', () => {
  it('modifica el mismo movimiento en lugar de crear otro', () => {
    const pending = movement({ status: 'pendiente', paidDate: null, dueDate: '2026-11-01' })
    const paid = markAsPaid(pending, '2026-10-30', 7000, NOW)
    expect(paid.id).toBe(pending.id)
    expect(paid).toMatchObject({ status: 'realizado', paidDate: '2026-10-30', dueDate: '2026-11-01', amountCents: 7000 })
  })
})

describe('validateRecurringDraft', () => {
  const recurring = (overrides: Partial<RecurringDraft> = {}): RecurringDraft => ({
    type: 'gasto',
    concept: 'Préstamo coche',
    amount: '210,35',
    categoryId: 'g-prestamos',
    frequency: 'mensual',
    startDate: '2026-11-05',
    endDate: '',
    installments: '48',
    notes: '',
    ...overrides,
  })

  it('acepta un préstamo con cuotas', () => {
    const result = validateRecurringDraft(recurring(), categories())
    expect(result.ok && result.value).toMatchObject({ amountCents: 21035, installments: 48, endDate: null })
  })

  it('rechaza cuotas no enteras y fechas de fin anteriores al inicio', () => {
    const result = validateRecurringDraft(recurring({ installments: '2,5', endDate: '2026-01-01' }), categories())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['endDate', 'installments'])
  })
})

describe('validateCategoryName', () => {
  it('evita nombres repetidos en el mismo grupo', () => {
    const scope = { type: 'gasto' as const, parentId: null }
    expect(validateCategoryName('ocio', categories(), scope)).toBe('Ya hay una categoría con ese nombre.')
    expect(validateCategoryName('Mascotas', categories(), scope)).toBeUndefined()
    // «Coche» existe como principal y dentro de Seguros, pero no dentro de Vivienda.
    expect(validateCategoryName('Coche', categories(), { type: 'gasto', parentId: 'g-vivienda' })).toBeUndefined()
  })
})
