import { addMonthsClamped } from '../shared/common/dates.ts'
import { validateCategory, validateFinanceData, validateMovement, validateRecurring } from '../shared/finance/backup.ts'
import { withDescendants } from '../shared/finance/categories.ts'
import { generationHorizon, planOccurrences, scheduleDates } from '../shared/finance/recurring.ts'
import { forecastMovements, monthView, yearView } from '../shared/finance/summaryViews.ts'
import { corpusJson } from './ticketRules.ts'

/**
 * Ejecutor del corpus de reglas de finanzas (fixtures/migration/rules-finance.json), común al
 * generador (tests/generateFinanceRules.ts) y a la prueba (tests/migrationFinanceRules.test.ts).
 * Cada operación llama a una función de TypeScript tal cual y su resultado se pasa a JSON con
 * corpusJson, como en el corpus de tickets: así lo compara C#
 * (backend/tests/CuentasClaras.Tests/FinanceRulesCorpusTests.cs).
 */

// oxlint-disable-next-line no-explicit-any
type Input = any

/** Un cuerpo de petición: `bodyJson` es el texto tal cual llegaría (JSON.parse), `body` ya es JSON y sin ninguno es undefined. */
const bodyOf = (input: Input): unknown => (typeof input.bodyJson === 'string' ? JSON.parse(input.bodyJson) : input.body)

const OPERATIONS: Record<string, (input: Input) => unknown> = {
  // shared/finance/backup.ts: lo que valida el servidor en cada ruta
  validateCategory: (i) => validateCategory(bodyOf(i)),
  validateMovement: (i) => validateMovement(bodyOf(i)),
  validateRecurring: (i) => validateRecurring(bodyOf(i)),
  validateFinanceData: (i) => validateFinanceData(bodyOf(i)),
  // shared/finance/categories.ts
  withDescendants: (i) => withDescendants(i.categories, i.categoryId),
  // shared/common/dates.ts y shared/finance/recurring.ts (FIN-03): vencimientos, día 31, cuotas y exclusiones
  addMonthsClamped: (i) => addMonthsClamped(i.value, i.months),
  generationHorizon: (i) => generationHorizon(i.today),
  scheduleDates: (i) => scheduleDates(i.rule, i.until),
  // Los ids nuevos, «id-1», «id-2»…, en el orden en que se piden.
  planOccurrences: (i) => {
    let next = 0
    return planOccurrences(i.rule, i.existing, i.horizon, i.now, () => `id-${++next}`)
  },
  // shared/finance/summaryViews.ts (FIN-04): lo que devuelven las consultas de resumen de .NET
  forecastMovements: (i) => forecastMovements(i.data, i.today, i.until),
  monthView: (i) => monthView(i.data, i.today, i.year, i.month),
  yearView: (i) => yearView(i.data, i.today, i.year),
  // localeCompare(…, 'es'), con que se ordenan categorías y totales: el signo de cada pareja (fila contra columna).
  compareNames: (i) => (i.names as string[]).map((a) => (i.names as string[]).map((b) => Math.sign(a.localeCompare(b, 'es')))),
}

export const FINANCE_OPERATIONS = Object.keys(OPERATIONS).sort()

/** El resultado de TypeScript tal como lo guarda el corpus (ver corpusJson), o `{ throws: mensaje }`. */
export function runFinanceRule(operation: string, input: unknown): unknown {
  const run = OPERATIONS[operation]
  if (!run) throw new Error(`Operación desconocida en el corpus de finanzas: ${operation}`)
  let result: unknown
  try {
    result = run(input)
  } catch (error) {
    return { throws: (error as Error).message }
  }
  return corpusJson(result)
}
