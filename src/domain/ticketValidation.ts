import type { ValidationResult } from './backup.ts'
import { isValidISODate } from './dates.ts'
import { isPantryFrequency, MAX_PANTRY_CENTS, PANTRY_NAME_MAX } from './pantry.ts'
import { nameKey } from './ticketText.ts'
import type { TicketDecision, TicketSaveInput, TicketSaveLine } from './types.ts'

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
  return {
    rawName,
    quantity: int(raw.quantity, `${label}, cantidad`, 1, 999) as number,
    unitPriceCents: int(raw.unitPriceCents, `${label}, precio unitario`, 0, MAX_PANTRY_CENTS, true),
    amountCents: int(raw.amountCents, `${label}, importe`, -MAX_LINE_CENTS, MAX_LINE_CENTS, true),
    discountCents: int(raw.discountCents ?? 0, `${label}, descuento`, 0, MAX_LINE_CENTS) as number,
    weightKg: typeof weightKg === 'number' ? Math.round(weightKg * 1000) / 1000 : null,
    pricePerKgCents: int(raw.pricePerKgCents, `${label}, precio por kilo`, 0, MAX_PANTRY_CENTS, true),
    taxCode,
    occasional: raw.occasional === true,
  }
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
    const totalCents = int(raw.totalCents, 'El total', 0, MAX_LINE_CENTS, true)
    if (!Array.isArray(raw.lines) || raw.lines.length === 0) fail('El ticket no tiene ninguna línea.')
    if (raw.lines.length > MAX_LINES) fail(`Un ticket puede tener como máximo ${MAX_LINES} líneas.`)
    const lines = raw.lines.map(readLine)
    if (!isObject(raw.decisions)) fail('Faltan las decisiones de los productos.')
    const decisions: Record<string, TicketDecision> = {}
    for (const key of new Set(lines.map((line) => nameKey(line.rawName)))) {
      decisions[key] = readDecision((raw.decisions as Raw)[key], key)
    }
    return { ok: true, value: { store: raw.store, storeName, address, date: raw.date, time, totalCents, lines, decisions } }
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
