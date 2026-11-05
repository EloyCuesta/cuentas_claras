import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isValidISODate, toISODate } from '../shared/common/dates.ts'
import { formatEuros } from '../shared/common/money.ts'
import type { PantryUnit } from '../shared/pantry/types.ts'
import { calculatedAmount, canApplyLine, lineProblems, roundRatio } from '../shared/tickets/ticketArithmetic.ts'
import { assessUnits, assessWeight, printedDigits, singleDigitEdit, singleEditVariants } from '../shared/tickets/ticketEvidence.ts'
import { suggestForTicket } from '../shared/tickets/ticketMatch.ts'
import { CHECK_LABELS, checkTaxGroups, checkTicket, endsProducts, linesFromText, mergePages, parseTicket, readTaxGroups } from '../shared/tickets/ticketParse.ts'
import { guessFrequency, nameKey, prettyName, similarity } from '../shared/tickets/ticketText.ts'
import { validateLineUpdate, validateTicketSave } from '../shared/tickets/ticketValidation.ts'
import { purchasesFromLines } from '../server/modules/tickets/domain/purchaseHistory.ts'
import { aliasStoreOf, fingerprintSource, imagesSource, pastedTextSource } from '../server/modules/tickets/domain/ticketIdentity.ts'
import { lineReviewStatus, newItemUnit, priceFromLines, quantityFromLines } from '../server/modules/tickets/domain/ticketPurchase.ts'

/**
 * Ejecutor del corpus de reglas de tickets (fixtures/migration/rules-tickets.json), común al
 * generador (tests/generateTicketRules.ts) y a la prueba (tests/migrationTicketRules.test.ts).
 * Cada operación llama a una función de TypeScript tal cual, y su resultado se pasa a JSON con
 * corpusJson: así lo compara C# (backend/tests/CuentasClaras.Tests/TicketRulesCorpusTests.cs).
 */

/** Las entradas vienen del JSON del corpus: cada operación toma los campos de su función, sin completarlos. */
// oxlint-disable-next-line no-explicit-any
type Input = any

const ROOT = new URL('..', import.meta.url)
const sha256 = (parts: readonly (string | Uint8Array)[]) => {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part)
  return hash.digest('hex')
}

/** Un cuerpo de petición: `bodyJson` es el texto tal cual llegaría (JSON.parse), `body` ya es JSON y sin ninguno es undefined. */
const bodyOf = (input: Input): unknown => typeof input.bodyJson === 'string' ? JSON.parse(input.bodyJson) : input.body

const OPERATIONS: Record<string, (input: Input) => unknown> = {
  // shared/common
  formatEuros: (i) => formatEuros(i.cents, i.sign),
  isValidISODate: (i) => isValidISODate(i.value),
  toISODate: (i) => toISODate(i.year, i.month, i.day),
  // shared/tickets/ticketText.ts
  nameKey: (i) => nameKey(i.text),
  nameKeyEach: (i) => (i.texts as string[]).map(nameKey),
  similarity: (i) => similarity(i.a, i.b),
  prettyName: (i) => prettyName(i.raw),
  prettyNameEach: (i) => (i.texts as string[]).map(prettyName),
  guessFrequency: (i) => guessFrequency(i.raw),
  // shared/tickets/ticketArithmetic.ts
  roundRatio: (i) => roundRatio(i.numerator, i.denominator),
  calculatedAmount: (i) => calculatedAmount(i.line),
  lineProblems: (i) => lineProblems(i.line),
  canApplyLine: (i) => canApplyLine(i.line),
  // shared/tickets/ticketEvidence.ts
  singleDigitEdit: (i) => singleDigitEdit(i.read, i.expected),
  singleEditVariants: (i) => singleEditVariants(i.digits),
  printedDigits: (i) => printedDigits(i.cents),
  assessUnits: (i) => assessUnits(i.input),
  assessWeight: (i) => assessWeight(i.input),
  // shared/tickets/ticketParse.ts
  linesFromText: (i) => linesFromText(i.text),
  mergePages: (i) => mergePages(i.pages),
  parseTicket: (i) => parseTicket(i.pages),
  readTaxGroups: (i) => readTaxGroups(i.lines),
  checkTaxGroups: (i) => checkTaxGroups(i.lines, i.groups, i.adjustments),
  checkTicket: (i) => checkTicket(i.lines, i.totalCents, i.adjustments, i.options),
  endsProducts: (i) => endsProducts(i.text),
  checkLabels: () => CHECK_LABELS,
  // shared/tickets/ticketMatch.ts
  suggestForTicket: (i) => suggestForTicket(i.lines, i.aliases, i.items),
  // shared/tickets/ticketValidation.ts
  validateTicketSave: (i) => validateTicketSave(bodyOf(i)),
  validateLineUpdate: (i) => validateLineUpdate(bodyOf(i)),
  // server/modules/tickets/domain/ticketPurchase.ts
  priceFromLines: (i) => priceFromLines(i.lines, i.unit as PantryUnit),
  quantityFromLines: (i) => quantityFromLines(i.lines, i.unit as PantryUnit),
  newItemUnit: (i) => newItemUnit(i.lines),
  lineReviewStatus: (i) => lineReviewStatus(i.line),
  // server/modules/tickets/domain/ticketIdentity.ts: el texto o las partes y su SHA-256, como el Hasher
  aliasStoreOf: (i) => aliasStoreOf(i.store, i.storeName),
  fingerprintSource: (i) => { const source = fingerprintSource(i.input); return { source, sha256: sha256([source]) } },
  pastedTextSource: (i) => { const source = pastedTextSource(i.text); return { source, sha256: sha256([source]) } },
  imagesSource: (i) => {
    const images = [
      ...((i.files ?? []) as string[]).map((path) => new Uint8Array(readFileSync(new URL(path, ROOT)))),
      ...((i.images ?? []) as string[]).map((base64) => new Uint8Array(Buffer.from(base64, 'base64'))),
    ]
    const parts = imagesSource(images)
    return { parts, sha256: sha256(parts) }
  },
  // server/modules/tickets/domain/purchaseHistory.ts
  purchasesFromLines: (i) => purchasesFromLines(i.lines),
}

export const TICKET_OPERATIONS = Object.keys(OPERATIONS).sort()

/**
 * El resultado de TypeScript tal como lo guarda el corpus: el JSON de JSON.stringify (sin las
 * propiedades undefined), un Map como lista de pares en su orden, un Set como lista, unos bytes
 * como su longitud y su SHA-256, y un error como `{ throws: mensaje }`.
 */
export function runTicketRule(operation: string, input: unknown): unknown {
  const run = OPERATIONS[operation]
  if (!run) throw new Error(`Operación desconocida en el corpus de tickets: ${operation}`)
  let result: unknown
  try {
    result = run(input)
  } catch (error) {
    return { throws: (error as Error).message }
  }
  return corpusJson(result)
}

export function corpusJson(value: unknown): unknown {
  const text = JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Map) return [...item.entries()]
    if (item instanceof Set) return [...item]
    if (item instanceof Uint8Array) return { length: item.length, sha256: sha256([item]) }
    return item
  })
  return text === undefined ? null : JSON.parse(text)
}
