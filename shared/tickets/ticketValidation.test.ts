import { describe, expect, it } from 'vitest'
import { validateTicketSave } from './ticketValidation.ts'

// Lo demás de la validación lo fijan el corpus (tests/migrationTicketRules.test.ts) y las pruebas de la API.
const line = (overrides: Record<string, unknown> = {}) => ({
  rawName: 'PAN', quantity: 1, unitPriceCents: null, amountCents: 100, discountCents: 0, weightKg: null, pricePerKgCents: null, taxCode: 'A', ...overrides,
})
const body = (overrides: Record<string, unknown> = {}) => ({
  store: 'lidl', storeName: 'Lidl', date: '2026-10-28', time: '19:24', totalCents: 100, lines: [line()], decisions: { PAN: { kind: 'ignore' } }, ...overrides,
})
const evidence = (overrides: Record<string, unknown> = {}) => ({
  text: 'PAN 1,00 A', reread: null, recognizedCents: 100, calculatedCents: null, selectedBy: 'read', issues: [], ...overrides,
})
const discrepancy = (overrides: Record<string, unknown> = {}) => ({
  kind: 'units', verdict: 'read', recognizedCents: 100, calculatedCents: 120, explanation: '', reasons: [], ...overrides,
})

describe('validateTicketSave', () => {
  it('acepta un ticket que cuadra, con evidencia, discrepancia, opciones y un ajuste', () => {
    const input = body({
      lines: [line({ evidence: evidence({ discrepancy: discrepancy(), options: [{ cents: 100, origin: 'read' }] }) })],
      adjustments: [{ id: 'a1', label: 'Cupón', kind: 'coupon', amountCents: 0, needsReview: false }],
    })
    expect(validateTicketSave(input)).toMatchObject({ ok: true })
  })

  it.each([
    ['el origen del importe', body({ lines: [line({ evidence: evidence({ selectedBy: ['read'] }) })] }), 'Origen del importe no válido.'],
    ['el origen del importe, anidado', body({ lines: [line({ evidence: evidence({ selectedBy: [['manual']] }) })] }), 'Origen del importe no válido.'],
    ['el tipo de discrepancia', body({ lines: [line({ evidence: evidence({ discrepancy: discrepancy({ kind: ['units'] }) }) })] }), 'La discrepancia de lectura no es válida.'],
    ['el veredicto de la discrepancia', body({ lines: [line({ evidence: evidence({ discrepancy: discrepancy({ verdict: ['read'] }) }) })] }), 'La discrepancia de lectura no es válida.'],
    ['el origen de una opción', body({ lines: [line({ evidence: evidence({ options: [{ cents: 100, origin: ['read'] }] }) })] }), 'Las opciones de importe no son válidas.'],
    ['el tipo de ajuste', body({ adjustments: [{ id: 'a1', label: 'Cupón', kind: ['coupon'], amountCents: 0, needsReview: false }] }), 'Tipo de ajuste no válido.'],
  ])('rechaza una lista donde va un texto: %s', (_, input, message) => {
    expect(validateTicketSave(input)).toEqual({ ok: false, error: message })
  })
})
