import { describe, expect, it } from 'vitest'
import { categories, movement, NOW, rule } from '../testing/factories.ts'
import { parseBackup, serializeBackup } from './backup.ts'
import type { FinanceData } from './types.ts'

function sampleData(): FinanceData {
  const r = rule({ startDate: '2026-10-01', installments: 12 })
  return {
    categories: categories(),
    movements: [
      movement({ notes: 'Con "comillas"; y punto y coma' }),
      movement({
        recurringId: r.id,
        occurrenceDate: '2026-10-01',
        dueDate: '2026-10-01',
        status: 'pendiente',
        paidDate: null,
        installmentNumber: 1,
        categoryId: r.categoryId,
      }),
    ],
    recurring: [r],
  }
}

function backupWith(change: (json: { data: Record<string, unknown[]> }) => void): string {
  const json = JSON.parse(serializeBackup(sampleData(), NOW))
  change(json)
  return JSON.stringify(json)
}

describe('copia de seguridad JSON', () => {
  it('exportar y restaurar conserva exactamente los datos', () => {
    const data = sampleData()
    const result = parseBackup(serializeBackup(data, NOW))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual(data)
      expect(result.summary).toMatchObject({ movements: 2, recurring: 1, categories: data.categories.length })
    }
  })

  it.each([
    ['no es JSON', 'esto no es json', 'JSON válido'],
    ['es de otra aplicación', JSON.stringify({ app: 'otra', version: 1, data: {} }), 'no es una copia'],
    ['es de una versión futura', JSON.stringify({ app: 'cuentas-claras', version: 99, data: {} }), 'más nueva'],
  ])('rechaza un archivo que %s', (_, text, message) => {
    const result = parseBackup(text)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(message)
  })

  it('rechaza importes con decimales (no son céntimos)', () => {
    const result = parseBackup(backupWith((json) => ((json.data.movements[0] as { amountCents: number }).amountCents = 12.5)))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Movimiento nº 1')
  })

  it('rechaza referencias a categorías que no existen', () => {
    const result = parseBackup(backupWith((json) => ((json.data.movements[0] as { categoryId: string }).categoryId = 'nada')))
    expect(result.ok).toBe(false)
  })

  it('rechaza ids y vencimientos duplicados', () => {
    const duplicatedId = parseBackup(backupWith((json) => json.data.movements.push({ ...(json.data.movements[0] as object) })))
    expect(duplicatedId.ok).toBe(false)
    const duplicatedOccurrence = parseBackup(
      backupWith((json) => json.data.movements.push({ ...(json.data.movements[1] as object), id: 'otro-id' })),
    )
    expect(duplicatedOccurrence.ok).toBe(false)
  })

  it('rechaza movimientos pendientes sin fecha prevista', () => {
    const result = parseBackup(backupWith((json) => ((json.data.movements[1] as { dueDate: null }).dueDate = null)))
    expect(result.ok).toBe(false)
  })
})
