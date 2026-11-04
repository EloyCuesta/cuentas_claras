import { centsToInput, MINUS, parseAmount } from '#shared/common/money.ts'
import { isValidISODate } from '#shared/common/dates.ts'
import { calculatedAmount, lineProblems } from '#shared/tickets/ticketArithmetic.ts'
import { nameKey } from '#shared/tickets/ticketText.ts'
import type { TicketDraft, TicketSuggestion } from '#shared/tickets/ticketMatch.ts'
import { checkTaxGroups, checkTicket, type ParsedTicketLine, type TicketCheck, type TicketLineFlag, type TicketTaxGroup } from '#shared/tickets/ticketParse.ts'
import type { PantryFrequency } from '#shared/pantry/types.ts'
import type {
  TicketAdjustment,
  TicketAmountOption,
  TicketDecision,
  TicketEvidence,
  TicketSaveInput,
  TicketSaveLine,
} from '#shared/tickets/types.ts'

/**
 * El estado de la revisión de un ticket, sin React: lo que se ve y se edita
 * en TicketReview y lo que se envía al guardar.
 *
 * - initialReview: parte de lo que leyó el servidor (TicketDraft). Cada producto
 *   empieza con lo que se propone (lo aprendido, un nombre parecido o uno nuevo)
 *   y va al apartado «Para revisar» si le falta el importe, tiene alguna marca o
 *   se emparejó solo por parecido.
 * - Cada línea pasa por cuatro estados (lineState): comprobado → confirmado, o
 *   sugerido → confirmado, o pendiente. Solo «comprobado» y «confirmado» cambian
 *   la despensa al guardar; el resto se guarda en el ticket como pendiente.
 * - reviewCheck y reviewWarnings: la comprobación del total y del IVA tal como
 *   está la revisión ahora, y las advertencias que pedirán confirmación.
 * - reviewToInput: valida y convierte la revisión en lo que recibe
 *   POST /api/despensa/tickets. Las líneas con el mismo nombre deben ir al mismo
 *   producto.
 *
 * Los importes se escriben como texto (coma decimal) y se leen en céntimos.
 */

export type Choice =
  | { kind: 'item'; itemId: string }
  | { kind: 'new'; name: string; ownerId: string; frequency: PantryFrequency }
  | { kind: 'ignore' }

export interface ReviewLine extends ParsedTicketLine {
  occasional: boolean
  amountText: string
  quantityText: string
  unitPriceText: string
  weightText: string
  pricePerKgText: string
  discountText: string
  confirmed: boolean
  associationConfirmed: boolean
  /** «Dejar pendiente»: la línea se guarda en el ticket, pero no toca la despensa hasta revisarla. */
  heldPending: boolean
}
export interface ReviewAdjustment extends TicketAdjustment { amountText: string }
export type SectionId = 'revisar' | 'nuevos' | 'conocidos' | 'ignorados'
export interface ReviewState {
  storeName: string
  address: string
  date: string
  time: string
  totalText: string
  lines: ReviewLine[]
  adjustments: ReviewAdjustment[]
  choices: Record<string, Choice>
  sections: Record<string, SectionId>
  nextPosition: number
  distinctPurchase: boolean
  /** Desglose de IVA leído del ticket, para la comprobación cruzada. */
  taxGroups: TicketTaxGroup[]
}

/**
 * Estado de una línea en la revisión:
 * - comprobado: el lector no tiene ninguna duda (y la multiplicación, si la hay, coincide).
 * - confirmado: la has confirmado tú.
 * - sugerido: el lector propone un dato (p. ej. un importe calculado) que falta confirmar.
 * - pendiente: falta un dato, es incoherente o la has dejado pendiente.
 * Solo «comprobado» y «confirmado» cambian la despensa al guardar.
 */
export type LineState = 'comprobado' | 'confirmado' | 'sugerido' | 'pendiente'
export const LINE_STATE_LABELS: Record<LineState, string> = {
  comprobado: 'Leído sin dudas',
  confirmado: 'Confirmado',
  sugerido: 'Sugerido: confírmalo',
  pendiente: 'Pendiente',
}
export const WARNING_FLAGS: readonly TicketLineFlag[] = ['ilegible', 'deducido', 'dudoso', 'corregido']
const amountText = (cents: number | null) => cents === null ? '' : centsToInput(cents)

function choiceFromSuggestion(s: TicketSuggestion | undefined, rawName: string, ownerId: string): Choice {
  if (!s) return { kind: 'new', name: rawName, ownerId, frequency: 'semanal' }
  if (s.kind === 'item') return { kind: 'item', itemId: s.itemId }
  if (s.kind === 'ignore') return { kind: 'ignore' }
  return { kind: 'new', name: s.name, ownerId, frequency: s.frequency }
}
export function reviewLine(line: ParsedTicketLine): ReviewLine {
  return { ...line, occasional: false, amountText: amountText(line.amountCents), quantityText: String(line.quantity),
    unitPriceText: amountText(line.unitPriceCents), weightText: line.weightKg === null ? '' : String(line.weightKg).replace('.', ','),
    pricePerKgText: amountText(line.pricePerKgCents), discountText: amountText(line.discountCents), confirmed: false, associationConfirmed: true,
    heldPending: false }
}
export function initialReview(draft: TicketDraft, today: string, defaultOwnerId: string): ReviewState {
  const choices: Record<string, Choice> = {}
  const sections: Record<string, SectionId> = {}
  const lines = draft.ticket.lines.map(line => {
    const suggestion = draft.suggestions[line.key]
    choices[line.key] ??= choiceFromSuggestion(suggestion, line.rawName, defaultOwnerId)
    const fuzzy = suggestion?.kind === 'item' && suggestion.how !== 'recordado'
    const look = line.amountCents === null || line.flags.length > 0 || fuzzy
    const choice = choices[line.key]
    if (look) sections[line.key] = 'revisar'
    else sections[line.key] ??= choice.kind === 'new' ? 'nuevos' : choice.kind === 'item' ? 'conocidos' : 'ignorados'
    return { ...reviewLine(line), associationConfirmed: !fuzzy }
  })
  return { choices, sections, lines, storeName: draft.ticket.storeName, address: draft.ticket.address,
    date: draft.ticket.date ?? today, time: draft.ticket.time ?? '', totalText: amountText(draft.ticket.totalCents),
    adjustments: (draft.ticket.adjustments ?? []).map(a => ({ ...a, amountText: amountText(a.amountCents) })),
    nextPosition: lines.length, distinctPurchase: false, taxGroups: draft.ticket.taxGroups ?? [] }
}

export function readAmount(text: string): { ok: true; cents: number | null } | { ok: false } {
  const raw = text.replace(/\s/g, '')
  if (raw === '') return { ok: true, cents: null }
  const negative = raw.startsWith('-') || raw.startsWith(MINUS)
  const digits = negative ? raw.slice(1) : raw
  if (/^0+([.,]0{1,2})?$/.test(digits)) return { ok: true, cents: 0 }
  const parsed = parseAmount(digits)
  return parsed.ok ? { ok: true, cents: negative ? -parsed.cents : parsed.cents } : { ok: false }
}
export const lineAmount = (line: ReviewLine) => { const r = readAmount(line.amountText); return r.ok ? r.cents : null }

export function lineToInput(line: ReviewLine): { line: TicketSaveLine; errors: string[] } {
  const errors: string[] = []
  const money = (text: string, label: string, positive = false) => {
    const read = readAmount(text)
    if (!read.ok || (positive && read.cents !== null && read.cents < 0)) { errors.push(`${label}: importe no válido`); return null }
    return read.cents
  }
  const quantity = /^\d{1,3}$/.test(line.quantityText) ? Number(line.quantityText) : 0
  if (quantity < 1) errors.push('La cantidad debe estar entre 1 y 999')
  const weight = line.weightText.trim().replace(',', '.')
  const weightKg = weight === '' ? null : Number(weight)
  if (weightKg !== null && (!/^\d+(\.\d{1,3})?$/.test(weight) || weightKg <= 0 || weightKg > 1000)) errors.push('Escribe un peso positivo con hasta tres decimales')
  if (!line.rawName.trim() || line.rawName.trim().length > 80) errors.push('Escribe el nombre de la línea (hasta 80 caracteres)')
  const value: TicketSaveLine = { rawName: line.rawName.trim(), quantity, unitPriceCents: money(line.unitPriceText, 'Precio unitario', true),
    amountCents: money(line.amountText, 'Importe'), discountCents: money(line.discountText, 'Descuento', true) ?? 0,
    weightKg: Number.isFinite(weightKg) ? weightKg : null, pricePerKgCents: money(line.pricePerKgText, 'Precio por kilo', true),
    taxCode: line.taxCode, occasional: line.occasional, confirmed: line.confirmed, evidence: line.evidence }
  const issues = errors.length ? errors : lineProblems(value)
  value.reviewStatus = issues.length || line.heldPending || !line.associationConfirmed || (!line.confirmed && line.flags.length > 0) ||
    (!line.confirmed && (line.evidence?.issues.length ?? 0) > 0) ? 'pending' : 'verified'
  return { line: value, errors }
}
export function lineState(line: ReviewLine): LineState {
  const { line: input, errors } = lineToInput(line)
  if (line.heldPending || errors.length || lineProblems(input).length || !line.associationConfirmed) return 'pendiente'
  if (line.confirmed) return 'confirmado'
  return input.reviewStatus === 'pending' ? 'sugerido' : 'comprobado'
}

/** Las líneas que necesitan la comprobación visible: dudosas, incoherentes o dejadas pendientes. */
export function needsLineCheck(line: ReviewLine): boolean {
  const state = lineState(line)
  if (state === 'comprobado') return false
  if (state === 'confirmado') return (line.evidence?.discrepancy ?? null) !== null
  // Solo la asociación por parecido: eso se resuelve en el editor del producto.
  return line.heldPending || line.flags.length > 0 || (line.evidence?.issues.length ?? 0) > 0 || lineProblems(lineToInput(line).line).length > 0
}

/**
 * Cambios de «Usar 9,90 €»: pone ese importe, confirma la línea y anota de
 * dónde salió. La lectura original del OCR se conserva en la evidencia.
 */
export function chooseAmountChange(line: ReviewLine, option: TicketAmountOption): Partial<ReviewLine> {
  const selectedBy: TicketEvidence['selectedBy'] = option.origin === 'calculation' ? 'calculation' : option.origin
  return { amountText: centsToInput(option.cents), confirmed: true, heldPending: false, associationConfirmed: true,
    evidence: line.evidence ? { ...line.evidence, selectedBy } : line.evidence }
}

/** La comprobación del total tal como está la revisión ahora mismo (incluido el desglose de IVA). */
export function reviewCheck(review: ReviewState): TicketCheck & { taxMismatches: { code: string; differenceCents: number }[] } {
  const total = readAmount(review.totalText)
  const lines = review.lines.map(l => lineToInput(l).line)
  const adjustments = review.adjustments.map(a => { const r = readAmount(a.amountText); return { amountCents: r.ok ? r.cents : null } })
  const check = checkTicket(lines.map(l => ({ ...l, pending: l.reviewStatus === 'pending' })), total.ok ? total.cents : null, adjustments)
  const tax = checkTaxGroups(lines, review.taxGroups, adjustments)
  const taxMismatches = tax.conclusive ? tax.groups.filter(g => g.differenceCents !== null && g.differenceCents !== 0)
    .map(g => ({ code: g.code, differenceCents: g.differenceCents! })) : []
  return { ...check, status: check.status === 'cuadra' && taxMismatches.length ? 'pendiente' : check.status, taxMismatches }
}

export function currentCalculation(line: ReviewLine): number | null {
  const converted = lineToInput(line)
  return converted.errors.length ? null : calculatedAmount(converted.line)
}
export function reviewWarnings(review: ReviewState): string[] {
  const lines = review.lines.map(l => lineToInput(l).line)
  const check = reviewCheck(review)
  const warnings: string[] = []
  if (check.status === 'sin_total') warnings.push('Falta el total del ticket')
  if (check.status === 'no_cuadra') warnings.push('Las líneas y ajustes no cuadran con el total')
  if (check.status === 'incompleto') warnings.push('Faltan importes: la suma no se puede comprobar con el total')
  if (check.status === 'pendiente') warnings.push('La suma coincide con el total, pero hay datos dudosos sin confirmar')
  for (const m of check.taxMismatches) warnings.push(`El desglose de IVA ${m.code} no coincide con sus artículos`)
  const pending = lines.filter(l => l.reviewStatus === 'pending').length
  if (pending) warnings.push(`${pending} líneas quedarán pendientes y no actualizarán la despensa`)
  if (review.adjustments.some(a => a.needsReview)) warnings.push('Hay ajustes generales pendientes de confirmar')
  return warnings
}

export function reviewToInput(draft: TicketDraft, review: ReviewState, acknowledged = false): { ok: true; input: TicketSaveInput } | { ok: false; error: string } {
  if (!review.storeName.trim()) return { ok: false, error: 'Escribe el nombre de la tienda.' }
  if (!isValidISODate(review.date)) return { ok: false, error: 'Elige una fecha válida para el ticket.' }
  if (review.time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(review.time)) return { ok: false, error: 'Escribe una hora válida.' }
  const total = readAmount(review.totalText)
  if (!total.ok) return { ok: false, error: 'El total del ticket no es un importe válido.' }
  if (!review.lines.length) return { ok: false, error: 'Añade al menos una línea al ticket.' }
  const decisions: Record<string, TicketDecision> = {}
  const lines: TicketSaveLine[] = []
  for (const line of review.lines) {
    const parsed = lineToInput(line)
    if (parsed.errors.length) return { ok: false, error: `${line.rawName}: ${parsed.errors[0]}` }
    const choice = review.choices[line.key]
    if (!choice) return { ok: false, error: `Elige qué hacer con ${line.rawName}.` }
    if (choice.kind === 'new' && !choice.name.trim()) return { ok: false, error: 'Falta el nombre de algún producto nuevo.' }
    const decision: TicketDecision = choice.kind === 'new' ? { ...choice, name: choice.name.trim(), ownerId: choice.ownerId || null } : choice
    const key = nameKey(line.rawName)
    if (decisions[key] && JSON.stringify(decisions[key]) !== JSON.stringify(decision)) return { ok: false, error: `Las líneas ${line.rawName} tienen asociaciones distintas. Diferencia sus nombres o elige el mismo producto.` }
    decisions[key] = decision
    lines.push(parsed.line)
  }
  const adjustments: TicketAdjustment[] = []
  for (const a of review.adjustments) {
    const parsed = readAmount(a.amountText)
    if (!parsed.ok || !a.label.trim()) return { ok: false, error: 'Revisa el concepto y el importe de los ajustes.' }
    const { amountText: _text, ...rest } = a
    adjustments.push({ ...rest, amountCents: parsed.cents })
  }
  return { ok: true, input: { store: nameKey(review.storeName) === 'LIDL' ? 'lidl' : 'otra', storeName: review.storeName.trim(),
    address: review.address.trim(), date: review.date, time: review.time || null, totalCents: total.cents, lines, decisions, adjustments,
    issues: [...new Set([...(draft.ticket.issues ?? []).filter(i => !/total|fecha/i.test(i)), ...reviewWarnings(review)])],
    acknowledged, importId: draft.importId, sourceFingerprint: draft.sourceFingerprint, distinctPurchase: review.distinctPurchase } }
}