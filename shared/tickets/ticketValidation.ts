import type { ValidationResult } from '../common/validation.ts'
import { isValidISODate } from '../common/dates.ts'
import { isPantryFrequency, MAX_PANTRY_CENTS, PANTRY_NAME_MAX } from '../pantry/pantry.ts'
import { nameKey } from './ticketText.ts'
import { lineProblems } from './ticketArithmetic.ts'
import { checkTicket } from './ticketParse.ts'
import type {
  TicketAdjustment,
  TicketAmountOption,
  TicketDecision,
  TicketDiscrepancy,
  TicketEvidence,
  TicketSaveInput,
  TicketSaveLine,
} from './types.ts'

/** Validación de lo que llega a la API al guardar un ticket revisado. */

class InputError extends Error {}

type Raw = Record<string, unknown>
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

function fail(message: string): never {
  throw new InputError(message)
}

const MAX_LINES = 300
const MAX_LINE_CENTS = 10_000_000

function int(value: unknown, field: string, min: number, max: number, nullable = false): number | null {
  if (nullable && (value === null || value === undefined)) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    fail(`${field}: debe ser un número entero entre ${min} y ${max}${nullable ? ' (o null)' : ''}.`)
  }
  return value
}

function readLine(raw: unknown, index: number): TicketSaveLine {
  const label = `Línea ${index + 1}`
  if (!isObject(raw)) fail(`${label}: formato no válido.`)
  const rawName = typeof raw.rawName === 'string' ? raw.rawName.replace(/\s+/g, ' ').trim() : ''
  if (rawName === '' || rawName.length > PANTRY_NAME_MAX || nameKey(rawName) === '') fail(`${label}: falta el nombre o es demasiado largo.`)
  const weightKg = raw.weightKg
  if (weightKg !== null && weightKg !== undefined && (typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 1000)) {
    fail(`${label}: el peso no es válido.`)
  }
  const taxCode = raw.taxCode ?? null
  if (taxCode !== null && taxCode !== 'A' && taxCode !== 'B' && taxCode !== 'C') fail(`${label}: la letra del IVA debe ser A, B, C o null.`)
  const evidence = readEvidence(raw.evidence)
  const line: TicketSaveLine = {
    rawName,
    quantity: int(raw.quantity, `${label}, cantidad`, 1, 999) as number,
    unitPriceCents: int(raw.unitPriceCents, `${label}, precio unitario`, 0, MAX_PANTRY_CENTS, true),
    amountCents: int(raw.amountCents, `${label}, importe`, -MAX_LINE_CENTS, MAX_LINE_CENTS, true),
    discountCents: int(raw.discountCents ?? 0, `${label}, descuento`, 0, MAX_LINE_CENTS) as number,
    weightKg: typeof weightKg === 'number' ? Math.round(weightKg * 1000) / 1000 : null,
    pricePerKgCents: int(raw.pricePerKgCents, `${label}, precio por kilo`, 0, MAX_PANTRY_CENTS, true),
    taxCode,
    occasional: raw.occasional === true,
    confirmed: raw.confirmed === true,
    evidence,
  }
  // Invalid structure is rejected; incomplete/inconsistent economic data may
  // be archived but cannot change pantry stock or prices.
  const problems = lineProblems(line)
  line.reviewStatus = raw.reviewStatus === 'pending' || problems.length > 0 ||
    ((evidence?.issues.length ?? 0) > 0 && !line.confirmed) ? 'pending' : 'verified'
  return line
}

const shortText = (value: unknown, max = 400) => typeof value === 'string' ? value.slice(0, max) : ''

function readEvidence(raw: unknown): TicketEvidence | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isObject(raw)) fail('La evidencia de lectura no es válida.')
  if (!['read', 'reread', 'calculation', 'manual'].includes(String(raw.selectedBy))) fail('Origen del importe no válido.')
  if (!Array.isArray(raw.issues) || raw.issues.length > 20 || raw.issues.some(i => typeof i !== 'string' || i.length > 400)) fail('Incidencias de lectura no válidas.')
  const evidence: TicketEvidence = {
    text: typeof raw.text === 'string' ? raw.text.slice(0, 1000) : '',
    reread: typeof raw.reread === 'string' ? raw.reread.slice(0, 1000) : null,
    recognizedCents: int(raw.recognizedCents, 'Importe reconocido', -MAX_LINE_CENTS, MAX_LINE_CENTS, true),
    calculatedCents: int(raw.calculatedCents, 'Importe calculado', -MAX_LINE_CENTS, MAX_LINE_CENTS, true),
    selectedBy: raw.selectedBy as TicketEvidence['selectedBy'], issues: raw.issues as string[],
  }
  if (typeof raw.normalized === 'string') evidence.normalized = raw.normalized.slice(0, 1000)
  // La discrepancia original se guarda con el ticket: así se puede saber después qué leyó el OCR y por qué se propuso otra cifra.
  if (raw.discrepancy !== undefined && raw.discrepancy !== null) {
    const d = raw.discrepancy
    if (!isObject(d) || !['units', 'weight'].includes(String(d.kind)) || !['calculation', 'read', 'ambiguous'].includes(String(d.verdict)) ||
      !Array.isArray(d.reasons) || d.reasons.length > 10) fail('La discrepancia de lectura no es válida.')
    evidence.discrepancy = { kind: d.kind as TicketDiscrepancy['kind'], verdict: d.verdict as TicketDiscrepancy['verdict'],
      recognizedCents: int(d.recognizedCents, 'Importe leído', -MAX_LINE_CENTS, MAX_LINE_CENTS) as number,
      calculatedCents: int(d.calculatedCents, 'Importe calculado', -MAX_LINE_CENTS, MAX_LINE_CENTS) as number,
      explanation: shortText(d.explanation), reasons: d.reasons.map(r => shortText(r)) }
  }
  if (raw.options !== undefined) {
    if (!Array.isArray(raw.options) || raw.options.length > 4) fail('Las opciones de importe no son válidas.')
    evidence.options = raw.options.map(o => {
      if (!isObject(o) || !['read', 'reread', 'calculation'].includes(String(o.origin))) fail('Las opciones de importe no son válidas.')
      return { cents: int(o.cents, 'Opción de importe', -MAX_LINE_CENTS, MAX_LINE_CENTS) as number, origin: o.origin as TicketAmountOption['origin'] }
    })
  }
  return evidence
}

function readAdjustments(raw: unknown): TicketAdjustment[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > 100) fail('Ajustes del ticket no válidos.')
  const ids = new Set<string>()
  return raw.map(a => {
    if (!isObject(a) || typeof a.id !== 'string' || a.id.length === 0 || a.id.length > 100 || ids.has(a.id)) fail('Identificador de ajuste no válido o repetido.')
    ids.add(a.id)
    if (typeof a.label !== 'string' || !a.label.trim() || a.label.length > 120) fail('Escribe el concepto del ajuste.')
    if (!['discount', 'coupon', 'promotion', 'other'].includes(String(a.kind))) fail('Tipo de ajuste no válido.')
    return { id: a.id, label: a.label.trim(), kind: a.kind as TicketAdjustment['kind'],
      amountCents: int(a.amountCents, 'Importe del ajuste', -MAX_LINE_CENTS, MAX_LINE_CENTS, true),
      needsReview: a.needsReview !== false, originalText: typeof a.originalText === 'string' ? a.originalText.slice(0, 1000) : undefined }
  })
}

function readDecision(raw: unknown, key: string): TicketDecision {
  const label = `El producto «${key}»`
  if (!isObject(raw)) fail(`${label}: falta qué hacer con él.`)
  if (raw.kind === 'ignore') return { kind: 'ignore' }
  if (raw.kind === 'item') {
    if (typeof raw.itemId !== 'string' || raw.itemId === '') fail(`${label}: falta el producto de la despensa.`)
    return { kind: 'item', itemId: raw.itemId }
  }
  if (raw.kind === 'new') {
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (name === '' || name.length > PANTRY_NAME_MAX) fail(`${label}: el nombre del producto nuevo debe tener entre 1 y ${PANTRY_NAME_MAX} caracteres.`)
    const ownerId = raw.ownerId ?? null
    if (ownerId !== null && (typeof ownerId !== 'string' || ownerId === '')) fail(`${label}: la persona no es válida.`)
    if (!isPantryFrequency(raw.frequency)) fail(`${label}: la frecuencia no es válida.`)
    return { kind: 'new', name, ownerId, frequency: raw.frequency }
  }
  fail(`${label}: «kind» debe ser «item», «new» o «ignore».`)
}

export function validateTicketSave(raw: unknown): ValidationResult<TicketSaveInput> {
  try {
    if (!isObject(raw)) fail('Falta el cuerpo de la petición en JSON.')
    if (raw.store !== 'lidl' && raw.store !== 'otra') fail('El campo «store» debe ser «lidl» u «otra».')
    const storeName = typeof raw.storeName === 'string' ? raw.storeName.trim() : ''
    if (storeName === '' || storeName.length > 60) fail('Escribe el nombre de la tienda (hasta 60 caracteres).')
    const address = typeof raw.address === 'string' ? raw.address.trim().slice(0, 120) : ''
    if (!isValidISODate(raw.date)) fail('La fecha del ticket debe ser AAAA-MM-DD.')
    const time = raw.time ?? null
    if (time !== null && (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) fail('La hora del ticket debe ser HH:MM.')
    const totalCents = int(raw.totalCents, 'El total', -MAX_LINE_CENTS, MAX_LINE_CENTS, true)
    if (!Array.isArray(raw.lines) || raw.lines.length === 0) fail('El ticket no tiene ninguna línea.')
    if (raw.lines.length > MAX_LINES) fail(`Un ticket puede tener como máximo ${MAX_LINES} líneas.`)
    const lines = raw.lines.map(readLine)
    const adjustments = readAdjustments(raw.adjustments)
    const issues = raw.issues === undefined ? [] : raw.issues
    if (!Array.isArray(issues) || issues.length > 30 || issues.some(i => typeof i !== 'string' || i.length > 400)) fail('Incidencias del ticket no válidas.')
    const check = checkTicket(lines.map(l => ({ ...l, pending: l.reviewStatus === 'pending' })), totalCents, adjustments)
    if ((check.status !== 'cuadra' || lines.some(l => l.reviewStatus === 'pending') || adjustments.some(a => a.needsReview || a.amountCents === null) || issues.length > 0) && raw.acknowledged !== true) {
      fail('Confirma el guardado con las advertencias pendientes. Solo las líneas fiables actualizarán la despensa.')
    }
    if (!isObject(raw.decisions)) fail('Faltan las decisiones de los productos.')
    const decisions: Record<string, TicketDecision> = {}
    for (const key of new Set(lines.map((line) => nameKey(line.rawName)))) {
      decisions[key] = readDecision((raw.decisions as Raw)[key], key)
    }
    const identifier = (value: unknown, name: string) => {
      if (value === undefined) return undefined
      if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{16,128}$/.test(value)) fail(`${name} no válido.`)
      return value
    }
    return { ok: true, value: { store: raw.store, storeName, address, date: raw.date, time, totalCents, lines, decisions,
      adjustments, issues: issues as string[], acknowledged: raw.acknowledged === true,
      importId: identifier(raw.importId, 'Identificador de importación'), sourceFingerprint: identifier(raw.sourceFingerprint, 'Huella del origen'),
      distinctPurchase: raw.distinctPurchase === true } }
  } catch (error) {
    if (error instanceof InputError) return { ok: false, error: error.message }
    throw error
  }
}

/** { itemId }: cambiar el producto de una línea ya guardada (null = no seguirla). */
export function validateLineUpdate(raw: unknown): ValidationResult<{ itemId: string | null }> {
  if (!isObject(raw) || !('itemId' in raw)) return { ok: false, error: 'Falta el campo «itemId» (id del producto o null).' }
  const { itemId } = raw
  if (itemId !== null && (typeof itemId !== 'string' || itemId === '')) return { ok: false, error: 'El campo «itemId» debe ser un id o null.' }
  return { ok: true, value: { itemId } }
}
