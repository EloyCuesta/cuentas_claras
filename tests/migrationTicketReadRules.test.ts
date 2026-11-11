import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TICKET_READ_OPERATIONS, runTicketReadRule } from './ticketReadRules.ts'

/**
 * TIC-02: lo que hace Express con el cuerpo de la lectura de tickets sigue siendo lo que fija el
 * corpus (fixtures/migration/rules-ticket-read.json). El mismo corpus lo comprueba C# en
 * backend/tests/CuentasClaras.Tests/TicketReadCorpusTests.cs. Esta prueba no lo regenera: si
 * una regla cambia a propósito, se regenera con tests/generateTicketReadRules.ts, se revisa el diff y
 * se porta el cambio a C# (docs/pruebas.md).
 */

interface TicketReadCase { id: string; description: string; operation: string; input: unknown; expected: unknown }

const corpus = JSON.parse(readFileSync(new URL('../fixtures/migration/rules-ticket-read.json', import.meta.url), 'utf8')) as {
  format: string
  provenance: string
  operations: string[]
  cases: TicketReadCase[]
}

describe('lectura de tickets portable (TIC-02)', () => {
  it('identifica el corpus y no pierde casos ni operaciones', () => {
    expect(corpus.format).toBe('cuentas-claras-ticket-read-rules-v1')
    expect(corpus.provenance).toContain('Sin datos de la instalación')
    expect(corpus.cases).toHaveLength(90)
    expect(new Set(corpus.cases.map((test) => test.id)).size).toBe(corpus.cases.length)
    expect(corpus.operations).toEqual(TICKET_READ_OPERATIONS)
    expect([...new Set(corpus.cases.map((test) => test.operation))].sort()).toEqual(TICKET_READ_OPERATIONS)
  })

  it.each(corpus.cases)('$id: $description', (test) => {
    expect(runTicketReadRule(test.operation, structuredClone(test.input))).toStrictEqual(test.expected)
  })
})
