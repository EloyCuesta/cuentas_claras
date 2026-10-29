import type { ISODate } from '#shared/common/types.ts'
import type { MetaKey } from '#shared/finance/meta.ts'
import type { Category, FinanceData, Movement, RecurringRule } from '#shared/finance/types.ts'

/**
 * Persistencia de las finanzas: categorías, movimientos, recurrentes (con sus
 * fechas excluidas) y metadatos.
 *
 * Síncrona a propósito (better-sqlite3): los casos de uso la llaman dentro de
 * UnitOfWork.run. Es distinta del contrato asíncrono FinanceRepository de la
 * web (`src/features/finance/FinanceRepository.ts`), que habla con la API.
 */
export interface FinanceStore {
  /** Todo, ordenado por id; cada recurrente con sus fechas excluidas. */
  readAll(): FinanceData
  /** Borra las finanzas y escribe `data`, sin transacción propia (la abre quien llama). */
  writeAll(data: FinanceData): void

  listCategories(): Category[]
  getCategory(id: string): Category | null
  countChildren(categoryId: string): number
  /** Crea o actualiza (mismo id). */
  upsertCategory(category: Category): void
  /** Movimientos más recurrentes que usan alguna de esas categorías. */
  countCategoryUsage(categoryIds: readonly string[]): number
  /** Pasa a otra categoría los movimientos y recurrentes de esas categorías. */
  reassignCategories(categoryIds: readonly string[], replacementId: string, now: string): void
  deleteCategories(categoryIds: readonly string[]): void

  getMovement(id: string): Movement | null
  /** Movimientos de un recurrente (sus vencimientos), por id. */
  movementsOfRule(ruleId: string): Movement[]
  /** Crea un vencimiento. Lanza AppError('CONFLICT') si ya existe (índice único recurrente + fecha). */
  insertOccurrence(movement: Movement): void
  /** Crea o actualiza (mismo id). Lanza AppError('CONFLICT') si choca con un vencimiento que ya existe. */
  upsertMovement(movement: Movement): void
  deleteMovement(id: string): void
  deletePendingOfRule(ruleId: string): void

  /** Los recurrentes, por id, cada uno con sus fechas excluidas. */
  listRules(): RecurringRule[]
  hasRule(id: string): boolean
  /** Crea o actualiza el recurrente, sin tocar sus fechas excluidas. */
  upsertRule(rule: RecurringRule): void
  /** Borra el recurrente; sus fechas excluidas se van con él (en cascada). */
  deleteRule(id: string): void
  /** Si ya estaba, no hace nada. */
  addExcludedDate(ruleId: string, date: ISODate): void
  clearExcludedDates(ruleId: string): void

  getMeta(key: MetaKey): string | null
  setMeta(key: MetaKey, value: string): void

  /** Deja las finanzas como recién creadas: categorías iniciales y sin metadatos (solo pruebas). */
  reset(): void
}
