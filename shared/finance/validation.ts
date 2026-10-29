import { normalizeText } from './filters.ts'
import { parseAmount } from '../common/money.ts'
import { FREQUENCY_MONTHS } from './recurring.ts'
import { isValidISODate } from '../common/dates.ts'
import type { ISODate } from '../common/types.ts'
import type { Category, Frequency, Movement, MovementStatus, MovementType, RecurringRule } from './types.ts'
import type { FieldErrors } from '../common/validation.ts'

/**
 * Validación de formularios. Los formularios trabajan con texto (lo que escribe
 * el usuario) y aquí se convierte a valores del dominio o se devuelven errores
 * por campo, listos para mostrarse junto a cada campo.
 */

export const MAX_CONCEPT_LENGTH = 80
export const MAX_NOTES_LENGTH = 500
export const MAX_CATEGORY_NAME_LENGTH = 40
export const MAX_INSTALLMENTS = 600

export type ValidationResult<T, D> = { ok: true; value: T } | { ok: false; errors: FieldErrors<D> }

function validateConcept(concept: string): string | undefined {
  const trimmed = concept.trim()
  if (trimmed === '') return 'Escribe un concepto, por ejemplo «Supermercado».'
  if (trimmed.length > MAX_CONCEPT_LENGTH) return `Usa como máximo ${MAX_CONCEPT_LENGTH} caracteres.`
  return undefined
}

function validateCategory(categoryId: string, type: MovementType, categories: readonly Category[]): string | undefined {
  if (!categoryId) return 'Elige una categoría.'
  const category = categories.find((c) => c.id === categoryId)
  if (!category || category.type !== type) return 'Elige una categoría de la lista.'
  return undefined
}

function validateNotes(notes: string): string | undefined {
  return notes.length > MAX_NOTES_LENGTH ? `Usa como máximo ${MAX_NOTES_LENGTH} caracteres.` : undefined
}

// ---------------------------------------------------------------------------
// Movimientos

export interface MovementDraft {
  type: MovementType
  amount: string
  concept: string
  categoryId: string
  status: MovementStatus
  paidDate: string
  dueDate: string
  notes: string
}

export interface MovementValues {
  type: MovementType
  amountCents: number
  concept: string
  categoryId: string
  status: MovementStatus
  paidDate: ISODate | null
  dueDate: ISODate | null
  notes: string
}

export function validateMovementDraft(
  draft: MovementDraft,
  categories: readonly Category[],
): ValidationResult<MovementValues, MovementDraft> {
  const errors: FieldErrors<MovementDraft> = {}
  const amount = parseAmount(draft.amount)
  if (!amount.ok) errors.amount = amount.error
  const conceptError = validateConcept(draft.concept)
  if (conceptError) errors.concept = conceptError
  const categoryError = validateCategory(draft.categoryId, draft.type, categories)
  if (categoryError) errors.categoryId = categoryError
  const notesError = validateNotes(draft.notes)
  if (notesError) errors.notes = notesError

  if (draft.status === 'realizado') {
    if (!isValidISODate(draft.paidDate)) {
      errors.paidDate = draft.type === 'gasto' ? 'Indica la fecha de pago.' : 'Indica la fecha de cobro.'
    }
  } else if (!isValidISODate(draft.dueDate)) {
    errors.dueDate = 'Indica la fecha prevista.'
  }

  if (Object.keys(errors).length > 0 || !amount.ok) return { ok: false, errors }

  const paid = draft.status === 'realizado'
  return {
    ok: true,
    value: {
      type: draft.type,
      amountCents: amount.cents,
      concept: draft.concept.trim(),
      categoryId: draft.categoryId,
      status: draft.status,
      paidDate: paid ? draft.paidDate : null,
      // Si ya está pagado se conserva la fecha prevista original (si la tenía).
      dueDate: isValidISODate(draft.dueDate) ? draft.dueDate : null,
      notes: draft.notes.trim(),
    },
  }
}

/** Crea un movimiento nuevo o aplica los cambios a uno existente. */
export function buildMovement(values: MovementValues, existing: Movement | null, now: string, newId: () => string): Movement {
  const base: Movement = existing ?? {
    id: newId(),
    concept: '',
    amountCents: 0,
    type: values.type,
    categoryId: values.categoryId,
    status: values.status,
    paidDate: null,
    dueDate: null,
    notes: '',
    recurringId: null,
    occurrenceDate: null,
    installmentNumber: null,
    createdAt: now,
    updatedAt: now,
  }
  return { ...base, ...values, updatedAt: now }
}

/** Confirma el pago o cobro de un movimiento pendiente. Es el mismo movimiento: no se crea otro. */
export function markAsPaid(movement: Movement, paidDate: ISODate, amountCents: number, now: string): Movement {
  return { ...movement, status: 'realizado', paidDate, amountCents, updatedAt: now }
}

// ---------------------------------------------------------------------------
// Recurrentes

export interface RecurringDraft {
  type: MovementType
  concept: string
  amount: string
  categoryId: string
  frequency: Frequency
  startDate: string
  endDate: string
  installments: string
  notes: string
}

export interface RecurringValues {
  type: MovementType
  concept: string
  amountCents: number
  categoryId: string
  frequency: Frequency
  startDate: ISODate
  endDate: ISODate | null
  installments: number | null
  notes: string
}

export function validateRecurringDraft(
  draft: RecurringDraft,
  categories: readonly Category[],
): ValidationResult<RecurringValues, RecurringDraft> {
  const errors: FieldErrors<RecurringDraft> = {}
  const amount = parseAmount(draft.amount)
  if (!amount.ok) errors.amount = amount.error
  const conceptError = validateConcept(draft.concept)
  if (conceptError) errors.concept = conceptError
  const categoryError = validateCategory(draft.categoryId, draft.type, categories)
  if (categoryError) errors.categoryId = categoryError
  const notesError = validateNotes(draft.notes)
  if (notesError) errors.notes = notesError
  if (!(draft.frequency in FREQUENCY_MONTHS)) errors.frequency = 'Elige cada cuánto se repite.'

  if (!isValidISODate(draft.startDate)) errors.startDate = 'Indica la fecha del primer vencimiento.'
  if (draft.endDate !== '') {
    if (!isValidISODate(draft.endDate)) errors.endDate = 'La fecha de fin no es válida.'
    else if (isValidISODate(draft.startDate) && draft.endDate < draft.startDate) {
      errors.endDate = 'La fecha de fin no puede ser anterior al primer vencimiento.'
    }
  }

  let installments: number | null = null
  const installmentsText = draft.installments.trim()
  if (installmentsText !== '') {
    const value = Number(installmentsText)
    if (!/^\d+$/.test(installmentsText) || value < 1 || value > MAX_INSTALLMENTS) {
      errors.installments = `Escribe un número entero entre 1 y ${MAX_INSTALLMENTS}.`
    } else {
      installments = value
    }
  }

  if (Object.keys(errors).length > 0 || !amount.ok) return { ok: false, errors }
  return {
    ok: true,
    value: {
      type: draft.type,
      concept: draft.concept.trim(),
      amountCents: amount.cents,
      categoryId: draft.categoryId,
      frequency: draft.frequency,
      startDate: draft.startDate,
      endDate: draft.endDate === '' ? null : draft.endDate,
      installments,
      notes: draft.notes.trim(),
    },
  }
}

export function buildRecurringRule(
  values: RecurringValues,
  existing: RecurringRule | null,
  now: string,
  newId: () => string,
): RecurringRule {
  const base: RecurringRule = existing ?? {
    ...values,
    id: newId(),
    excludedDates: [],
    createdAt: now,
    updatedAt: now,
  }
  return { ...base, ...values, updatedAt: now }
}

// ---------------------------------------------------------------------------
// Categorías

export function validateCategoryName(
  name: string,
  categories: readonly Category[],
  scope: { type: MovementType; parentId: string | null; excludeId?: string },
): string | undefined {
  const trimmed = name.trim()
  if (trimmed === '') return 'Escribe un nombre.'
  if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) return `Usa como máximo ${MAX_CATEGORY_NAME_LENGTH} caracteres.`
  const duplicate = categories.some(
    (c) =>
      c.id !== scope.excludeId &&
      c.type === scope.type &&
      c.parentId === scope.parentId &&
      normalizeText(c.name) === normalizeText(trimmed),
  )
  return duplicate ? 'Ya hay una categoría con ese nombre.' : undefined
}
