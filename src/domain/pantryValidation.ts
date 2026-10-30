import type { ValidationResult } from './backup.ts'
import { parseAmount } from './money.ts'
import {
  checkQuantity,
  isPantryFrequency,
  isPantryUnit,
  MAX_PANTRY_CENTS,
  PANTRY_FREQUENCIES,
  PANTRY_NAME_MAX,
  PANTRY_NOTES_MAX,
  PANTRY_UNITS,
  PERSON_NAME_MAX,
} from './pantry.ts'
import { isCounted } from './pantryTracking.ts'
import { isValidISODate } from './dates.ts'
import type {
  ISODate,
  PantryEventKind,
  PantryFrequency,
  PantryItemInput,
  PantryPerson,
  PantryPurchaseChange,
  PantryTracking,
  PantryUnit,
} from './types.ts'
import type { FieldErrors } from './validation.ts'

/**
 * Validación de la despensa, compartida por el servidor (lo que llega a la API)
 * y la interfaz (lo que escribe el usuario en los formularios).
 *
 * No reutiliza la validación de importes financieros a propósito: allí un
 * importe tiene que ser mayor que 0, aquí un precio de 0 € es un dato válido.
 */

class InputError extends Error {}

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)

function attempt<T>(read: () => T): ValidationResult<T> {
  try {
    return { ok: true, value: read() }
  } catch (error) {
    if (error instanceof InputError) return { ok: false, error: error.message }
    throw error
  }
}

function fail(message: string): never {
  throw new InputError(message)
}

function readObject(raw: unknown): Raw {
  if (!isObject(raw)) fail('Falta el cuerpo de la petición en JSON.')
  return raw
}

function readName(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') fail(`${label}: falta el nombre.`)
  const name = value.trim()
  if (name === '') fail(`${label}: el nombre está vacío.`)
  if (name.length > max) fail(`${label}: el nombre puede tener como máximo ${max} caracteres.`)
  return name
}

function readCents(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_PANTRY_CENTS) {
    fail(`El campo «${field}» debe ser un número entero de céntimos entre 0 y ${MAX_PANTRY_CENTS}, o null.`)
  }
  return value
}

/** Persona: { name }. */
export function validatePersonInput(raw: unknown): ValidationResult<{ name: string }> {
  return attempt(() => ({ name: readName(readObject(raw).name, 'La persona', PERSON_NAME_MAX) }))
}

/** Producto: lo que envía la interfaz al crearlo o editarlo. */
export function validateItemInput(raw: unknown): ValidationResult<PantryItemInput> {
  return attempt(() => {
    const body = readObject(raw)
    const name = readName(body.name, 'El producto', PANTRY_NAME_MAX)

    const { ownerId } = body
    if (ownerId !== null && ownerId !== undefined && (typeof ownerId !== 'string' || ownerId === '')) {
      fail('El campo «ownerId» debe ser el id de una persona o null (Compartido).')
    }

    if (!isPantryUnit(body.unit)) fail(`El campo «unit» debe ser ${PANTRY_UNITS.map((u) => `«${u}»`).join(', ')}.`)
    const unit = body.unit
    if (!isPantryFrequency(body.frequency)) {
      fail(`El campo «frequency» debe ser ${PANTRY_FREQUENCIES.map((f) => `«${f}»`).join(', ')}.`)
    }

    const quantity = checkQuantity(body.quantity, unit)
    if (!quantity.ok) fail(`Cantidad actual: ${quantity.error}`)
    const target = checkQuantity(body.target, unit)
    if (!target.ok) fail(`Objetivo: ${target.error}`)

    const tracking = body.tracking ?? 'cantidad'
    if (tracking !== 'cantidad' && tracking !== 'compras') fail('El campo «tracking» debe ser «compras» o «cantidad».')

    const notes = body.notes ?? ''
    if (typeof notes !== 'string') fail('El campo «notes» debe ser texto.')
    if (notes.trim().length > PANTRY_NOTES_MAX) fail(`Las notas pueden tener como máximo ${PANTRY_NOTES_MAX} caracteres.`)

    return {
      name,
      ownerId: (ownerId as string | null | undefined) ?? null,
      unit,
      tracking: tracking as PantryTracking,
      quantity: quantity.value,
      target: target.value,
      frequency: body.frequency,
      priceCents: readCents(body.priceCents, 'priceCents'),
      notes: notes.trim(),
    }
  })
}

/** Presupuesto: { monthlyBudgetCents: número o null }. */
export function validateBudgetInput(raw: unknown): ValidationResult<{ monthlyBudgetCents: number | null }> {
  return attempt(() => {
    const body = readObject(raw)
    if (!('monthlyBudgetCents' in body)) fail('Falta el campo «monthlyBudgetCents» (número de céntimos o null).')
    return { monthlyBudgetCents: readCents(body.monthlyBudgetCents, 'monthlyBudgetCents') }
  })
}

const MAX_IDS = 1000

function readOptionalDate(value: unknown, field: string): ISODate | null {
  if (value === undefined || value === null) return null
  if (!isValidISODate(value)) fail(`El campo «${field}» debe ser una fecha AAAA-MM-DD.`)
  return value
}

/** { ids, date? }: lista no vacía de ids, sin repetidos, y la fecha de la compra (la de hoy del usuario). */
export function validatePurchaseInput(raw: unknown): ValidationResult<{ ids: string[]; date: ISODate | null }> {
  return attempt(() => {
    const { ids, date } = readObject(raw)
    if (!Array.isArray(ids) || ids.length === 0) fail('Indica al menos un producto en «ids».')
    if (ids.length > MAX_IDS) fail(`Se pueden indicar como máximo ${MAX_IDS} productos a la vez.`)
    if (!ids.every((id) => typeof id === 'string' && id !== '' && id.length <= 200)) fail('Cada elemento de «ids» debe ser un id.')
    return { ids: [...new Set(ids as string[])], date: readOptionalDate(date, 'date') }
  })
}

/** { kind, date }: «Queda», «Se acabó» o «Lo he comprado», con la fecha de hoy del usuario. */
export function validateEventInput(raw: unknown): ValidationResult<{ kind: PantryEventKind; date: ISODate }> {
  return attempt(() => {
    const { kind, date } = readObject(raw)
    if (kind !== 'queda' && kind !== 'poco' && kind !== 'se_acabo' && kind !== 'comprado') {
      fail('El campo «kind» debe ser «queda», «poco», «se_acabo» o «comprado».')
    }
    const checked = readOptionalDate(date, 'date')
    if (!checked) fail('Falta el campo «date» (AAAA-MM-DD).')
    return { kind, date: checked }
  })
}

/** { date }: el día en que se hizo el repaso de la semana. */
export function validateReviewInput(raw: unknown): ValidationResult<{ date: ISODate }> {
  return attempt(() => {
    const { date } = readObject(raw)
    const checked = readOptionalDate(date, 'date')
    if (!checked) fail('Falta el campo «date» (AAAA-MM-DD).')
    return { date: checked }
  })
}

/** { changes }: lo que devolvió la compra, para deshacerla. */
export function validateUndoInput(raw: unknown): ValidationResult<PantryPurchaseChange[]> {
  return attempt(() => {
    const { changes } = readObject(raw)
    if (!Array.isArray(changes) || changes.length === 0) fail('Indica los cambios que hay que deshacer en «changes».')
    if (changes.length > MAX_IDS) fail(`Se pueden deshacer como máximo ${MAX_IDS} productos a la vez.`)
    const seen = new Set<string>()
    return changes.map((change: unknown): PantryPurchaseChange => {
      if (!isObject(change)) fail('Cada cambio debe tener «id» y «previousQuantity» y «version», o «eventId».')
      const { id, previousQuantity, version, eventId } = change
      if (typeof id !== 'string' || id === '' || seen.has(id)) fail('Cada cambio debe tener un «id» distinto.')
      seen.add(id)
      if (eventId !== undefined) {
        if (typeof eventId !== 'string' || eventId === '' || eventId.length > 200) fail('El campo «eventId» no es válido.')
        return { id, eventId }
      }
      if (typeof previousQuantity !== 'number' || !Number.isFinite(previousQuantity) || previousQuantity < 0) {
        fail('El campo «previousQuantity» debe ser una cantidad válida.')
      }
      if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) fail('El campo «version» no es válido.')
      return { id, previousQuantity, version }
    })
  })
}

/** { delta }: lo que suma (positivo) o resta (negativo) un botón + o −. */
export function validateDeltaInput(raw: unknown): ValidationResult<number> {
  return attempt(() => {
    const { delta } = readObject(raw)
    if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1_000_000) {
      fail('El campo «delta» debe ser un número distinto de 0.')
    }
    return delta
  })
}

// ---------------------------------------------------------------------------
// Formularios

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Cantidad escrita por el usuario: "2", "1,5", "0.25", "250". Coma o punto
 * como separador decimal; sin separador de miles para no confundir "1.500".
 */
export function parseQuantityInput(text: string): ParseResult<number> {
  const raw = text.replace(/\s/g, '')
  if (raw === '') return { ok: false, error: 'Escribe una cantidad, por ejemplo 2 o 1,5.' }
  if (raw.startsWith('-') || raw.startsWith('−')) return { ok: false, error: 'La cantidad no puede ser negativa.' }
  if (!/^\d+([.,]\d+)?$/.test(raw)) return { ok: false, error: 'Escribe solo números, con coma para los decimales (por ejemplo 1,5).' }
  const [integer, decimals = ''] = raw.split(/[.,]/)
  if (decimals.length > 3) return { ok: false, error: 'Usa como máximo 3 decimales.' }
  if (integer.replace(/^0+(?=\d)/, '').length > 7) return { ok: false, error: 'La cantidad es demasiado grande.' }
  return { ok: true, value: Number(`${integer}.${decimals || '0'}`) }
}

/** Precio o presupuesto escrito por el usuario. Vacío = desconocido (null); "0" = 0 € (conocido). */
export function parsePantryCentsInput(text: string): ParseResult<number | null> {
  const raw = text.replace(/[\s\u00a0\u202f€]/g, '')
  if (raw === '') return { ok: true, value: null }
  if (/^0+([.,]0{1,2})?$/.test(raw) || /^[.,]0{1,2}$/.test(raw)) return { ok: true, value: 0 }
  const parsed = parseAmount(raw)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  if (parsed.cents > MAX_PANTRY_CENTS) return { ok: false, error: 'El importe es demasiado grande.' }
  return { ok: true, value: parsed.cents }
}

/** Valor para un campo de texto: 1.5 → "1,5". */
export const quantityToInput = (value: number) => String(value).replace('.', ',')

export interface PantryItemDraft {
  name: string
  /** '' = Compartido. */
  ownerId: string
  unit: PantryUnit
  tracking: PantryTracking
  quantity: string
  target: string
  frequency: PantryFrequency
  price: string
  notes: string
}

export function validateItemDraft(
  draft: PantryItemDraft,
  people: readonly PantryPerson[],
): { ok: true; value: PantryItemInput } | { ok: false; errors: FieldErrors<PantryItemDraft> } {
  const errors: FieldErrors<PantryItemDraft> = {}
  const name = draft.name.trim()
  if (name === '') errors.name = 'Escribe el nombre del producto, por ejemplo «Leche».'
  else if (name.length > PANTRY_NAME_MAX) errors.name = `Usa como máximo ${PANTRY_NAME_MAX} caracteres.`

  if (draft.ownerId !== '' && !people.some((p) => p.id === draft.ownerId)) errors.ownerId = 'Elige una persona de la lista.'

  // Los que se siguen por compras no usan cantidades: se guardan a 0.
  const amounts: Partial<Record<'quantity' | 'target', number>> = isCounted(draft) ? {} : { quantity: 0, target: 0 }
  for (const key of isCounted(draft) ? (['quantity', 'target'] as const) : []) {
    const parsed = parseQuantityInput(draft[key])
    if (!parsed.ok) {
      errors[key] = parsed.error
      continue
    }
    // La unidad decide si se admiten decimales: al cambiarla se vuelven a comprobar las dos cantidades.
    const checked = checkQuantity(parsed.value, draft.unit)
    if (checked.ok) amounts[key] = checked.value
    else errors[key] = checked.error
  }

  const price = parsePantryCentsInput(draft.price)
  if (!price.ok) errors.price = price.error

  if (draft.notes.trim().length > PANTRY_NOTES_MAX) errors.notes = `Usa como máximo ${PANTRY_NOTES_MAX} caracteres.`

  if (Object.keys(errors).length > 0 || !price.ok || amounts.quantity === undefined || amounts.target === undefined) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    value: {
      name,
      ownerId: draft.ownerId === '' ? null : draft.ownerId,
      unit: draft.unit,
      tracking: draft.tracking,
      quantity: amounts.quantity,
      target: amounts.target,
      frequency: draft.frequency,
      priceCents: price.value,
      notes: draft.notes.trim(),
    },
  }
}
