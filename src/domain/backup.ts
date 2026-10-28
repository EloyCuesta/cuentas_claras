import { DEFAULT_CATEGORIES } from './categories.ts'
import { isValidISODate } from './dates.ts'
import { MAX_CENTS } from './money.ts'
import { FREQUENCY_MONTHS, MAX_OCCURRENCES } from './recurring.ts'
import type { Category, FinanceData, Frequency, Movement, MovementStatus, MovementType, RecurringRule } from './types.ts'

/**
 * Copias de seguridad en JSON.
 *
 * Al restaurar se valida todo el archivo antes de tocar los datos: estructura,
 * tipos, importes, fechas, ids repetidos y referencias entre registros. Si algo
 * falla se explica qué registro tiene el problema y no se sustituye nada.
 */

export const BACKUP_APP = 'cuentas-claras'
export const BACKUP_VERSION = 1

export interface BackupFile {
  app: typeof BACKUP_APP
  version: number
  exportedAt: string
  data: FinanceData
}

export interface BackupSummary {
  exportedAt: string
  categories: number
  movements: number
  recurring: number
}

export type BackupParseResult =
  | { ok: true; data: FinanceData; summary: BackupSummary }
  | { ok: false; error: string }

export function createBackup(data: FinanceData, now: string): BackupFile {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now, data }
}

export function serializeBackup(data: FinanceData, now: string): string {
  return JSON.stringify(createBackup(data, now), null, 2)
}

class BackupError extends Error {}

type Raw = Record<string, unknown>

function isObject(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Lee campos de un registro y lanza un error legible si no son válidos. */
class FieldReader {
  private readonly raw: Raw
  private readonly label: string

  constructor(raw: unknown, label: string) {
    if (!isObject(raw)) throw new BackupError(`${label} no tiene un formato válido.`)
    this.raw = raw
    this.label = label
  }

  fail(message: string): never {
    throw new BackupError(`${this.label}: ${message}`)
  }

  string(key: string, options: { max: number; allowEmpty?: boolean }): string {
    const value = this.raw[key]
    if (typeof value !== 'string') this.fail(`falta el campo «${key}» o no es texto.`)
    if (!options.allowEmpty && value.trim() === '') this.fail(`el campo «${key}» está vacío.`)
    if (value.length > options.max) this.fail(`el campo «${key}» es demasiado largo.`)
    return value
  }

  nullableString(key: string, max: number): string | null {
    return this.raw[key] === null || this.raw[key] === undefined ? null : this.string(key, { max })
  }

  oneOf<T extends string>(key: string, allowed: readonly T[]): T {
    const value = this.raw[key]
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.fail(`el campo «${key}» debe ser ${allowed.map((a) => `«${a}»`).join(' o ')}.`)
    }
    return value as T
  }

  date(key: string): string {
    const value = this.raw[key]
    if (!isValidISODate(value)) this.fail(`el campo «${key}» no es una fecha válida (AAAA-MM-DD).`)
    return value
  }

  nullableDate(key: string): string | null {
    return this.raw[key] === null || this.raw[key] === undefined ? null : this.date(key)
  }

  integer(key: string, min: number, max: number): number {
    const value = this.raw[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      this.fail(`el campo «${key}» debe ser un número entero entre ${min} y ${max}.`)
    }
    return value
  }

  nullableInteger(key: string, min: number, max: number): number | null {
    return this.raw[key] === null || this.raw[key] === undefined ? null : this.integer(key, min, max)
  }

  number(key: string): number {
    const value = this.raw[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) this.fail(`el campo «${key}» debe ser un número.`)
    return value
  }

  dateList(key: string): string[] {
    const value = this.raw[key] ?? []
    if (!Array.isArray(value) || !value.every(isValidISODate)) this.fail(`el campo «${key}» debe ser una lista de fechas.`)
    return [...value]
  }
}

const TYPES: readonly MovementType[] = ['ingreso', 'gasto']
const STATUSES: readonly MovementStatus[] = ['pendiente', 'realizado']
const FREQUENCIES = Object.keys(FREQUENCY_MONTHS) as Frequency[]

function readCategory(raw: unknown, label: string): Category {
  const r = new FieldReader(raw, label)
  return {
    id: r.string('id', { max: 100 }),
    name: r.string('name', { max: 200 }),
    type: r.oneOf('type', TYPES),
    parentId: r.nullableString('parentId', 100),
    order: r.number('order'),
    budgetCents: r.nullableInteger('budgetCents', 0, MAX_CENTS),
  }
}

function readMovement(raw: unknown, label: string): Movement {
  const r = new FieldReader(raw, label)
  const movement: Movement = {
    id: r.string('id', { max: 100 }),
    concept: r.string('concept', { max: 500 }),
    amountCents: r.integer('amountCents', 1, MAX_CENTS),
    type: r.oneOf('type', TYPES),
    categoryId: r.string('categoryId', { max: 100 }),
    status: r.oneOf('status', STATUSES),
    paidDate: r.nullableDate('paidDate'),
    dueDate: r.nullableDate('dueDate'),
    notes: r.string('notes', { max: 5000, allowEmpty: true }),
    recurringId: r.nullableString('recurringId', 100),
    occurrenceDate: r.nullableDate('occurrenceDate'),
    installmentNumber: r.nullableInteger('installmentNumber', 1, MAX_OCCURRENCES),
    createdAt: r.string('createdAt', { max: 40 }),
    updatedAt: r.string('updatedAt', { max: 40 }),
  }
  if (movement.status === 'realizado' && !movement.paidDate) r.fail('está realizado pero no tiene fecha de pago o cobro.')
  if (movement.status === 'pendiente' && !movement.dueDate) r.fail('está pendiente pero no tiene fecha prevista.')
  return movement
}

function readRecurring(raw: unknown, label: string): RecurringRule {
  const r = new FieldReader(raw, label)
  const rule: RecurringRule = {
    id: r.string('id', { max: 100 }),
    concept: r.string('concept', { max: 500 }),
    amountCents: r.integer('amountCents', 1, MAX_CENTS),
    type: r.oneOf('type', TYPES),
    categoryId: r.string('categoryId', { max: 100 }),
    frequency: r.oneOf('frequency', FREQUENCIES),
    startDate: r.date('startDate'),
    endDate: r.nullableDate('endDate'),
    installments: r.nullableInteger('installments', 1, MAX_OCCURRENCES),
    notes: r.string('notes', { max: 5000, allowEmpty: true }),
    excludedDates: r.dateList('excludedDates'),
    createdAt: r.string('createdAt', { max: 40 }),
    updatedAt: r.string('updatedAt', { max: 40 }),
  }
  if (rule.endDate && rule.endDate < rule.startDate) r.fail('la fecha de fin es anterior a la de inicio.')
  return rule
}

function readList<T>(
  container: Raw,
  key: string,
  label: string,
  itemLabel: string,
  read: (raw: unknown, label: string) => T,
): T[] {
  const value = container[key]
  if (!Array.isArray(value)) throw new BackupError(`La copia no contiene la lista de ${label}.`)
  return value.map((raw, index) => read(raw, `${itemLabel} nº ${index + 1}`))
}

function assertUniqueIds(records: { id: string }[], label: string): void {
  const seen = new Set<string>()
  for (const record of records) {
    if (seen.has(record.id)) throw new BackupError(`Hay ${label} con el id repetido «${record.id}».`)
    seen.add(record.id)
  }
}

/** Comprueba que las referencias entre registros son coherentes. */
function assertIntegrity(data: FinanceData): void {
  assertUniqueIds(data.categories, 'categorías')
  assertUniqueIds(data.movements, 'movimientos')
  assertUniqueIds(data.recurring, 'recurrentes')

  const categories = new Map(data.categories.map((c) => [c.id, c]))
  for (const category of data.categories) {
    if (category.parentId === null) continue
    const parent = categories.get(category.parentId)
    if (!parent || parent.parentId !== null || parent.type !== category.type) {
      throw new BackupError(`La subcategoría «${category.name}» apunta a una categoría principal que no existe.`)
    }
  }
  const checkCategory = (categoryId: string, type: MovementType, label: string) => {
    const category = categories.get(categoryId)
    if (!category || category.type !== type) throw new BackupError(`${label} usa una categoría que no existe.`)
  }
  data.movements.forEach((m, i) => checkCategory(m.categoryId, m.type, `El movimiento nº ${i + 1} («${m.concept}»)`))
  data.recurring.forEach((r, i) => checkCategory(r.categoryId, r.type, `El recurrente nº ${i + 1} («${r.concept}»)`))

  const occurrences = new Set<string>()
  for (const movement of data.movements) {
    if (!movement.recurringId || !movement.occurrenceDate) continue
    const key = `${movement.recurringId}|${movement.occurrenceDate}`
    if (occurrences.has(key)) {
      throw new BackupError(`El vencimiento del ${movement.occurrenceDate} de «${movement.concept}» está duplicado.`)
    }
    occurrences.add(key)
  }
}

/** Lee las tres listas, valida cada registro y comprueba las referencias entre ellos. */
function readFinanceData(raw: Raw): FinanceData {
  const data: FinanceData = {
    categories: readList(raw, 'categories', 'categorías', 'Categoría', readCategory),
    movements: readList(raw, 'movements', 'movimientos', 'Movimiento', readMovement),
    recurring: readList(raw, 'recurring', 'recurrentes', 'Recurrente', readRecurring),
  }
  assertIntegrity(data)
  return data
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

function attempt<T>(read: () => T): ValidationResult<T> {
  try {
    return { ok: true, value: read() }
  } catch (error) {
    if (error instanceof BackupError) return { ok: false, error: error.message }
    throw error
  }
}

/*
 * Validación de los datos que recibe el servidor, con las mismas reglas que una
 * copia de seguridad. Devuelven el registro limpio (solo los campos conocidos).
 */

export function validateCategory(raw: unknown): ValidationResult<Category> {
  return attempt(() => readCategory(raw, 'La categoría'))
}

export function validateMovement(raw: unknown): ValidationResult<Movement> {
  return attempt(() => readMovement(raw, 'El movimiento'))
}

export function validateRecurring(raw: unknown): ValidationResult<RecurringRule> {
  return attempt(() => readRecurring(raw, 'El recurrente'))
}

/** Valida todos los datos de la aplicación: cada registro y las referencias entre ellos. */
export function validateFinanceData(raw: unknown): ValidationResult<FinanceData> {
  return attempt(() => {
    if (!isObject(raw)) throw new BackupError('No se han recibido los datos.')
    return readFinanceData(raw)
  })
}

const categoryKey = (c: Category) => JSON.stringify([c.id, c.name, c.type, c.parentId, c.order, c.budgetCents])

/**
 * true si hay algo del usuario: movimientos, recurrentes o categorías distintas
 * de las iniciales (nombres, presupuestos…). Sirve para no importar encima de
 * datos que ya existen.
 */
export function hasUserData(data: FinanceData): boolean {
  if (data.movements.length > 0 || data.recurring.length > 0) return true
  const defaults = new Set(DEFAULT_CATEGORIES.map(categoryKey))
  return data.categories.length !== defaults.size || data.categories.some((c) => !defaults.has(categoryKey(c)))
}

/** Valida el texto de un archivo de copia. No modifica nada. */
export function parseBackup(text: string): BackupParseResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'El archivo no contiene JSON válido.' }
  }
  try {
    if (!isObject(json) || json.app !== BACKUP_APP) {
      throw new BackupError('El archivo no es una copia de seguridad de Cuentas claras.')
    }
    if (typeof json.version !== 'number') throw new BackupError('La copia no indica su versión.')
    if (json.version > BACKUP_VERSION) {
      throw new BackupError('La copia se hizo con una versión más nueva de la aplicación. Actualízala antes de restaurar.')
    }
    if (json.version !== BACKUP_VERSION) throw new BackupError(`Versión de copia no compatible (${json.version}).`)
    if (!isObject(json.data)) throw new BackupError('La copia no contiene datos.')

    const data = readFinanceData(json.data)
    return {
      ok: true,
      data,
      summary: {
        exportedAt: typeof json.exportedAt === 'string' ? json.exportedAt : '',
        categories: data.categories.length,
        movements: data.movements.length,
        recurring: data.recurring.length,
      },
    }
  } catch (error) {
    if (error instanceof BackupError) return { ok: false, error: error.message }
    throw error
  }
}
