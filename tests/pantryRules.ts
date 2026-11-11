import { addDays } from '../shared/common/dates.ts'
import { checkQuantity, sortItems, sortPeople, stepQuantity } from '../shared/pantry/pantry.ts'
import {
  validateBudgetInput,
  validateDeltaInput,
  validateEventInput,
  validateItemInput,
  validateItemUpdate,
  validatePersonInput,
  validatePurchaseInput,
  validateReviewInput,
  validateUndoInput,
} from '../shared/pantry/pantryValidation.ts'
import { corpusJson } from './ticketRules.ts'

/**
 * Ejecutor del corpus de reglas de la despensa (fixtures/migration/rules-pantry.json), común al generador
 * (tests/generatePantryRules.ts) y a la prueba (tests/migrationPantryRules.test.ts). Cada operación llama a una función
 * de TypeScript tal cual y su resultado se pasa a JSON con corpusJson, como en los corpus de tickets y finanzas: así lo
 * compara C# (backend/tests/CuentasClaras.Tests/PantryRulesCorpusTests.cs). PAN-02 y PAN-03 añaden las suyas.
 */

// oxlint-disable-next-line no-explicit-any
type Input = any

/** Un cuerpo de petición: `bodyJson` es el texto tal cual llegaría (JSON.parse), `body` ya es JSON y sin ninguno es undefined. */
const bodyOf = (input: Input): unknown => (typeof input.bodyJson === 'string' ? JSON.parse(input.bodyJson) : input.body)

const OPERATIONS: Record<string, (input: Input) => unknown> = {
  // shared/pantry/pantryValidation.ts (PAN-01): lo que valida el servidor en las rutas de personas y productos
  validatePersonInput: (i) => validatePersonInput(bodyOf(i)),
  validateItemInput: (i) => validateItemInput(bodyOf(i)),
  validateItemUpdate: (i) => validateItemUpdate(bodyOf(i)),
  // PAN-02: + y −, «Marcar todo como comprado» y «Deshacer»
  validateDeltaInput: (i) => validateDeltaInput(bodyOf(i)),
  validatePurchaseInput: (i) => validatePurchaseInput(bodyOf(i)),
  validateUndoInput: (i) => validateUndoInput(bodyOf(i)),
  stepQuantity: (i) => stepQuantity(i.quantity, i.delta),
  // PAN-03: revisiones, presupuesto, repaso y la ventana de la actividad (hoy − 400 días)
  validateEventInput: (i) => validateEventInput(bodyOf(i)),
  validateBudgetInput: (i) => validateBudgetInput(bodyOf(i)),
  validateReviewInput: (i) => validateReviewInput(bodyOf(i)),
  addDays: (i) => addDays(i.value, i.days),
  // shared/pantry/pantry.ts: cantidades en milésimas y el orden de las listas (los ids, en el orden que quedan)
  checkQuantity: (i) => checkQuantity(bodyOf(i), i.unit),
  sortPeople: (i) => sortPeople(i.people).map((person) => person.id),
  sortItems: (i) => sortItems(i.items).map((item) => item.id),
}

export const PANTRY_OPERATIONS = Object.keys(OPERATIONS).sort()

/** El resultado de TypeScript tal como lo guarda el corpus (ver corpusJson), o `{ throws: mensaje }`. */
export function runPantryRule(operation: string, input: unknown): unknown {
  const run = OPERATIONS[operation]
  if (!run) throw new Error(`Operación desconocida en el corpus de la despensa: ${operation}`)
  let result: unknown
  try {
    result = run(input)
  } catch (error) {
    return { throws: (error as Error).message }
  }
  return corpusJson(result)
}
