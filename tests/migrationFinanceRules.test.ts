import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FINANCE_OPERATIONS, runFinanceRule } from './financeRules.ts'

/**
 * FIN-01 y siguientes: las reglas de finanzas que usa el servidor siguen dando lo que fija el
 * corpus (fixtures/migration/rules-finance.json). El mismo corpus lo comprueba C# en
 * backend/tests/CuentasClaras.Tests/FinanceRulesCorpusTests.cs. Esta prueba no lo regenera: si
 * una regla cambia a propósito, se regenera con tests/generateFinanceRules.ts, se revisa el diff y
 * se porta el cambio a C# (docs/pruebas.md).
 */

interface FinanceRuleCase { id: string; description: string; operation: string; input: unknown; expected: unknown }

const corpus = JSON.parse(readFileSync(new URL('../fixtures/migration/rules-finance.json', import.meta.url), 'utf8')) as {
  format: string
  provenance: string
  operations: string[]
  cases: FinanceRuleCase[]
}

describe('reglas de finanzas portables (FIN-01)', () => {
  it('identifica el corpus y no pierde casos ni operaciones', () => {
    expect(corpus.format).toBe('cuentas-claras-finance-rules-v1')
    expect(corpus.provenance).toContain('Sin datos de la instalación')
    expect(corpus.cases).toHaveLength(177)
    expect(new Set(corpus.cases.map((test) => test.id)).size).toBe(corpus.cases.length)
    expect(corpus.operations).toEqual(FINANCE_OPERATIONS)
    expect([...new Set(corpus.cases.map((test) => test.operation))].sort()).toEqual(FINANCE_OPERATIONS)
  })

  it.each(corpus.cases)('$id: $description', (test) => {
    expect(runFinanceRule(test.operation, structuredClone(test.input))).toStrictEqual(test.expected)
  })
})
