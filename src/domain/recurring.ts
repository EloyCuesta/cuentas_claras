import { addMonthsClamped, endOfNextMonth } from './dates.ts'
import type { Frequency, ISODate, Movement, RecurringRule } from './types.ts'

/**
 * Pagos recurrentes y cuotas.
 *
 * Un recurrente es una regla ("650 € cada mes desde el 01/11/2026"). Cada
 * vencimiento que genera es un Movimiento pendiente normal, marcado con
 * recurringId + occurrenceDate. Esa pareja es única: si ya existe un
 * movimiento para una fecha programada, nunca se crea otro.
 */

export const FREQUENCY_MONTHS: Record<Frequency, number> = {
  mensual: 1,
  trimestral: 3,
  semestral: 6,
  anual: 12,
}

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  mensual: 'Mensual',
  trimestral: 'Trimestral',
  semestral: 'Semestral',
  anual: 'Anual',
}

export const FREQUENCY_DESCRIPTIONS: Record<Frequency, string> = {
  mensual: 'Cada mes',
  trimestral: 'Cada 3 meses',
  semestral: 'Cada 6 meses',
  anual: 'Cada año',
}

/** Tope de seguridad: 100 años de cuotas mensuales. */
export const MAX_OCCURRENCES = 1200

/** Hasta qué fecha se crean vencimientos: el final del mes siguiente a hoy. */
export function generationHorizon(today: ISODate): ISODate {
  return endOfNextMonth(today)
}

/**
 * Fechas programadas de un recurrente hasta `until` (incluida), respetando la
 * fecha de fin y el número de cuotas. Cada fecha se calcula desde la fecha de
 * inicio, así que un día 31 vuelve a ser 31 en los meses que lo tienen.
 */
export function scheduleDates(rule: Pick<RecurringRule, 'startDate' | 'endDate' | 'installments' | 'frequency'>, until: ISODate): ISODate[] {
  const step = FREQUENCY_MONTHS[rule.frequency]
  const dates: ISODate[] = []
  const limit = Math.min(rule.installments ?? MAX_OCCURRENCES, MAX_OCCURRENCES)
  for (let index = 0; index < limit; index++) {
    const date = addMonthsClamped(rule.startDate, index * step)
    if (rule.endDate !== null && date > rule.endDate) break
    if (date > until) break
    dates.push(date)
  }
  return dates
}

/** Fechas de todo el recurrente si tiene final (cuotas o fecha de fin); si no, null. */
export function fullSchedule(rule: RecurringRule): ISODate[] | null {
  if (rule.installments === null && rule.endDate === null) return null
  return scheduleDates(rule, '2999-12-31')
}

function occurrenceFromRule(rule: RecurringRule, date: ISODate, index: number, now: string, id: string): Movement {
  return {
    id,
    concept: rule.concept,
    amountCents: rule.amountCents,
    type: rule.type,
    categoryId: rule.categoryId,
    status: 'pendiente',
    paidDate: null,
    dueDate: date,
    notes: rule.notes,
    recurringId: rule.id,
    occurrenceDate: date,
    installmentNumber: rule.installments !== null ? index + 1 : null,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Calcula los vencimientos que faltan por crear para una regla, sin tocar nada.
 * `existing` son los movimientos ya guardados de esa regla.
 */
export function planOccurrences(
  rule: RecurringRule,
  existing: readonly Movement[],
  horizon: ISODate,
  now: string,
  newId: () => string,
): Movement[] {
  const taken = new Set<string>()
  for (const movement of existing) {
    if (movement.recurringId === rule.id && movement.occurrenceDate) taken.add(movement.occurrenceDate)
  }
  const excluded = new Set(rule.excludedDates)
  const planned: Movement[] = []
  scheduleDates(rule, horizon).forEach((date, index) => {
    if (taken.has(date) || excluded.has(date)) return
    planned.push(occurrenceFromRule(rule, date, index, now, newId()))
  })
  return planned
}

const PROJECTION_PREFIX = 'proyeccion:'

/**
 * Vencimientos que tendrán los recurrentes después del horizonte de generación,
 * hasta `until` (incluida). Sirven para la previsión de meses lejanos: se
 * calculan al vuelo y nunca se guardan, así que no se pueden pagar ni editar
 * hasta que la aplicación los cree de verdad. Su id es estable
 * ("proyeccion:<recurrente>:<fecha>") para usarlo como clave en la interfaz.
 */
export function projectOccurrences(
  rules: readonly RecurringRule[],
  movements: readonly Movement[],
  horizon: ISODate,
  until: ISODate,
): Movement[] {
  if (until <= horizon) return []
  return rules.flatMap((rule) =>
    planOccurrences(rule, movements, until, rule.updatedAt, () => '')
      .filter((m) => (m.occurrenceDate as string) > horizon)
      .map((m) => ({ ...m, id: `${PROJECTION_PREFIX}${rule.id}:${m.occurrenceDate}` })),
  )
}

/** true si el movimiento es una proyección de un recurrente (no está guardado). */
export function isProjected(movement: Movement): boolean {
  return movement.id.startsWith(PROJECTION_PREFIX)
}

export interface RecurringStatus {
  /** Número total de vencimientos si el recurrente tiene final. */
  total: number | null
  paid: number
  /** Vencimientos que quedan por pagar (incluye los pendientes ya creados). */
  remaining: number | null
  /** Próximo vencimiento sin pagar (puede estar vencido). */
  nextDate: ISODate | null
  /** Importe del próximo vencimiento (puede haberse editado). */
  nextAmountCents: number | null
  finished: boolean
}

/** Situación de un recurrente: cuántas cuotas se han pagado y cuántas quedan. */
export function recurringStatus(rule: RecurringRule, movements: readonly Movement[], today: ISODate): RecurringStatus {
  const own = movements.filter((m) => m.recurringId === rule.id)
  const byDate = new Map(own.filter((m) => m.occurrenceDate).map((m) => [m.occurrenceDate as string, m]))
  const excluded = new Set(rule.excludedDates)
  const full = fullSchedule(rule)
  // Para recurrentes sin final basta con mirar unos años por delante.
  const dates = full ?? scheduleDates(rule, addMonthsClamped(generationHorizon(today), 24))

  const paid = own.filter((m) => m.status === 'realizado').length
  const unpaid = dates.filter((date) => !excluded.has(date) && byDate.get(date)?.status !== 'realizado')
  const next = unpaid[0] ?? null
  const nextMovement = next ? byDate.get(next) : undefined

  return {
    total: full ? full.length : null,
    paid,
    remaining: full ? unpaid.length : null,
    nextDate: nextMovement?.dueDate ?? next,
    nextAmountCents: next ? (nextMovement?.amountCents ?? rule.amountCents) : null,
    finished: full !== null && unpaid.length === 0,
  }
}

/** Fechas que se crearán en el pasado (antes de hoy) al guardar una regla nueva. */
export function pastDates(rule: Pick<RecurringRule, 'startDate' | 'endDate' | 'installments' | 'frequency'>, today: ISODate): ISODate[] {
  return scheduleDates(rule, today).filter((date) => date < today)
}
