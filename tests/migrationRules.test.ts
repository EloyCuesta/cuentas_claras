import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { addMonthsClamped, daysBetween, describeDue, parseISODate } from '../shared/common/dates.ts'
import { parseAmount } from '../shared/common/money.ts'
import { checkQuantity, stepQuantity } from '../shared/pantry/pantry.ts'
import { parsePantryCentsInput } from '../shared/pantry/pantryValidation.ts'
import type { PantryUnit } from '../shared/pantry/types.ts'
import { calculatedAmount, canApplyLine, roundRatio } from '../shared/tickets/ticketArithmetic.ts'
import type { TicketSaveLine } from '../shared/tickets/types.ts'

/**
 * Ejemplos portables de reglas para BASE-01: entradas y resultados completos
 * en JSON, sin reloj, base de datos ni expectativas calculadas por el test.
 * El portado a C# podrá ejecutar el mismo corpus contra sus propias reglas.
 */

type RuleCase = { id: string; description: string; expected: unknown } & (
  | { operation: 'parseAmount' | 'parsePantryCentsInput'; input: { text: string } }
  | { operation: 'checkQuantity'; input: { value: number; unit: PantryUnit } }
  | { operation: 'stepQuantity'; input: { quantity: number; delta: number } }
  | { operation: 'parseISODate'; input: { date: string } }
  | { operation: 'addMonthsClamped'; input: { date: string; months: number } }
  | { operation: 'daysBetween'; input: { from: string; to: string } }
  | { operation: 'describeDue'; input: { dueDate: string; today: string } }
  | { operation: 'roundRatio'; input: { numerator: number; denominator: number } }
  | { operation: 'calculatedAmount'; input: Parameters<typeof calculatedAmount>[0] }
  | { operation: 'canApplyLine'; input: TicketSaveLine }
)

const corpus = JSON.parse(readFileSync(new URL('../fixtures/migration/rules.json', import.meta.url), 'utf8')) as {
  format: string
  provenance: string
  cases: RuleCase[]
}

/** Selecciona la regla, sin normalizar ni corregir los datos o el resultado. */
function execute(test: RuleCase): unknown {
  switch (test.operation) {
    case 'parseAmount': return parseAmount(test.input.text)
    case 'parsePantryCentsInput': return parsePantryCentsInput(test.input.text)
    case 'checkQuantity': return checkQuantity(test.input.value, test.input.unit)
    case 'stepQuantity': return stepQuantity(test.input.quantity, test.input.delta)
    case 'parseISODate': return parseISODate(test.input.date)
    case 'addMonthsClamped': return addMonthsClamped(test.input.date, test.input.months)
    case 'daysBetween': return daysBetween(test.input.from, test.input.to)
    case 'describeDue': return describeDue(test.input.dueDate, test.input.today)
    case 'roundRatio': return roundRatio(test.input.numerator, test.input.denominator)
    case 'calculatedAmount': return calculatedAmount(test.input)
    case 'canApplyLine': return canApplyLine(test.input)
    default: throw new Error('El corpus contiene una operación de reglas desconocida')
  }
}

describe('reglas portables de migración', () => {
  it('identifica el corpus sintético y no pierde casos ni familias de reglas', () => {
    expect(corpus.format).toBe('cuentas-claras-rules-v1')
    expect(corpus.provenance).toContain('inventados')
    expect(corpus.cases).toHaveLength(42)
    expect(new Set(corpus.cases.map((test) => test.id)).size).toBe(corpus.cases.length)
    expect([...new Set(corpus.cases.map((test) => test.operation))].sort()).toEqual([
      'addMonthsClamped', 'calculatedAmount', 'canApplyLine', 'checkQuantity', 'daysBetween', 'describeDue',
      'parseAmount', 'parseISODate', 'parsePantryCentsInput', 'roundRatio', 'stepQuantity',
    ].sort())
  })

  it.each(corpus.cases)('$id: $description', (test) => {
    expect(execute(test)).toEqual(test.expected)
  })
})
