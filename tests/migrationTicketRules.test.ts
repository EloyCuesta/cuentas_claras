import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runTicketRule, TICKET_OPERATIONS } from './ticketRules.ts'

/**
 * TIC-01: las reglas puras de los tickets siguen dando lo que fija el corpus
 * (fixtures/migration/rules-tickets.json). El mismo corpus lo comprueba C# en
 * backend/tests/CuentasClaras.Tests/TicketRulesCorpusTests.cs. Esta prueba no lo
 * regenera: si una regla cambia a propósito, se regenera con tests/generateTicketRules.ts,
 * se revisa el diff y se porta el cambio a C# (docs/pruebas.md).
 */

interface TicketRuleCase { id: string; description: string; operation: string; input: unknown; expected: unknown }

const corpus = JSON.parse(readFileSync(new URL('../fixtures/migration/rules-tickets.json', import.meta.url), 'utf8')) as {
  format: string
  provenance: string
  operations: string[]
  cases: TicketRuleCase[]
}

/** Las huellas de «las huellas no cambian…» (server/modules/tickets/tickets.test.ts). */
const GOLDEN: Record<string, string> = {
  'huella-golden-texto': 'a8737b2f4204b7b1b9c9b81440ae55228438a252a379693401a3cdfdc19a71e4',
  'huella-golden-imagenes': '74707bc9bd62595e3ac455802d512b5aa806bf0bc49a863157e635ad2b397a5e',
  'huella-golden-ticket': '4ee26779153a9a0ba92b3af35f8f543155cfe656884bd3d4d5693140d5baeb30',
}

describe('reglas de tickets portables (TIC-01)', () => {
  it('identifica el corpus y no pierde casos ni operaciones', () => {
    expect(corpus.format).toBe('cuentas-claras-ticket-rules-v1')
    expect(corpus.provenance).toContain('Sin datos de la instalación')
    expect(corpus.cases).toHaveLength(510)
    expect(new Set(corpus.cases.map((test) => test.id)).size).toBe(corpus.cases.length)
    expect(corpus.operations).toEqual(TICKET_OPERATIONS)
    expect([...new Set(corpus.cases.map((test) => test.operation))].sort()).toEqual(TICKET_OPERATIONS)
  })

  it('contiene las tres huellas golden de los tickets guardados', () => {
    for (const [id, sha256] of Object.entries(GOLDEN)) {
      expect(corpus.cases.find((test) => test.id === id)?.expected).toMatchObject({ sha256 })
    }
  })

  it.each(corpus.cases)('$id: $description', (test) => {
    expect(runTicketRule(test.operation, structuredClone(test.input))).toStrictEqual(test.expected)
  })
})
