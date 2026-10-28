import { DEFAULT_CATEGORIES } from '../domain/categories.ts'
import type { Category, Movement, RecurringRule } from '../domain/types.ts'

/** Datos de prueba con valores por defecto razonables. */

let counter = 0
export const testId = (prefix = 'id') => `${prefix}-${++counter}`

export const NOW = '2026-10-28T08:00:00.000Z'

export function categories(): Category[] {
  return DEFAULT_CATEGORIES.map((c) => ({ ...c }))
}

export function movement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: testId('mov'),
    concept: 'Supermercado',
    amountCents: 5430,
    type: 'gasto',
    categoryId: 'g-alimentacion-supermercado',
    status: 'realizado',
    paidDate: '2026-10-12',
    dueDate: null,
    notes: '',
    recurringId: null,
    occurrenceDate: null,
    installmentNumber: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function rule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: testId('rule'),
    concept: 'Alquiler',
    amountCents: 65000,
    type: 'gasto',
    categoryId: 'g-vivienda-alquiler',
    frequency: 'mensual',
    startDate: '2026-11-01',
    endDate: null,
    installments: null,
    notes: '',
    excludedDates: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}
