import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PANTRY_OPERATIONS, runPantryRule } from './pantryRules.ts'

/**
 * PAN-01 y siguientes: las reglas de la despensa que usa el servidor siguen dando lo que fija el
 * corpus (fixtures/migration/rules-pantry.json). El mismo corpus lo comprueba C# en
 * backend/tests/CuentasClaras.Tests/PantryRulesCorpusTests.cs. Esta prueba no lo regenera: si
 * una regla cambia a propósito, se regenera con tests/generatePantryRules.ts, se revisa el diff y
 * se porta el cambio a C# (docs/pruebas.md).
 */

interface PantryRuleCase { id: string; description: string; operation: string; input: unknown; expected: unknown }

const corpus = JSON.parse(readFileSync(new URL('../fixtures/migration/rules-pantry.json', import.meta.url), 'utf8')) as {
  format: string
  provenance: string
  operations: string[]
  cases: PantryRuleCase[]
}

describe('reglas de la despensa portables (PAN-01)', () => {
  it('identifica el corpus y no pierde casos ni operaciones', () => {
    expect(corpus.format).toBe('cuentas-claras-pantry-rules-v1')
    expect(corpus.provenance).toContain('Sin datos de la instalación')
    expect(corpus.cases).toHaveLength(102)
    expect(new Set(corpus.cases.map((test) => test.id)).size).toBe(corpus.cases.length)
    expect(corpus.operations).toEqual(PANTRY_OPERATIONS)
    expect([...new Set(corpus.cases.map((test) => test.operation))].sort()).toEqual(PANTRY_OPERATIONS)
  })

  it.each(corpus.cases)('$id: $description', (test) => {
    expect(runPantryRule(test.operation, structuredClone(test.input))).toStrictEqual(test.expected)
  })
})
