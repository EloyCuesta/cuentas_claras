import type { ISODate } from '#shared/common/types.ts'
import type { MetaKey } from '#shared/finance/meta.ts'
import type { Category, FinanceData, Movement, RecurringRule } from '#shared/finance/types.ts'

/**
 * Persistencia de las finanzas: categorías, movimientos, recurrentes (con sus
 * fechas excluidas) y metadatos.
 *
 * Async (MySQL): los casos de uso la llaman dentro de UnitOfWork.run, con el
 * bloqueo «finance» si escriben. Es distinta del contrato FinanceRepository de
 * la web (`src/features/finance/FinanceRepository.ts`), que habla con la API.
 */
export interface FinanceStore {
  /** Todo, ordenado por id; cada recurrente con sus fechas excluidas. */
  readAll(): Promise<FinanceData>
  /** Borra las finanzas y escribe `data`, sin transacción propia (la abre quien llama). */
  writeAll(data: FinanceData): Promise<void>

  listCategories(): Promise<Category[]>
  getCategory(id: string): Promise<Category | null>
  countChildren(categoryId: string): Promise<number>
  /** Crea o actualiza (mismo id). */
  upsertCategory(category: Category): Promise<void>
  /** Movimientos más recurrentes que usan alguna de esas categorías. */
  countCategoryUsage(categoryIds: readonly string[]): Promise<number>
  /** Pasa a otra categoría los movimientos y recurrentes de esas categorías. */
  reassignCategories(categoryIds: readonly string[], replacementId: string, now: string): Promise<void>
  deleteCategories(categoryIds: readonly string[]): Promise<void>

  getMovement(id: string): Promise<Movement | null>
  /** Movimientos de un recurrente (sus vencimientos), por id. */
  movementsOfRule(ruleId: string): Promise<Movement[]>
  /** Crea un vencimiento. Lanza AppError('CONFLICT') si ya existe (índice único recurrente + fecha). */
  insertOccurrence(movement: Movement): Promise<void>
  /** Crea o actualiza (mismo id). Lanza AppError('CONFLICT') si choca con un vencimiento que ya existe. */
  upsertMovement(movement: Movement): Promise<void>
  deleteMovement(id: string): Promise<void>
  deletePendingOfRule(ruleId: string): Promise<void>

  /** Los recurrentes, por id, cada uno con sus fechas excluidas. */
  listRules(): Promise<RecurringRule[]>
  hasRule(id: string): Promise<boolean>
  /** Crea o actualiza el recurrente, sin tocar sus fechas excluidas. */
  upsertRule(rule: RecurringRule): Promise<void>
  /** Borra el recurrente; sus fechas excluidas se van con él (en cascada). */
  deleteRule(id: string): Promise<void>
  /** Si ya estaba, no hace nada. */
  addExcludedDate(ruleId: string, date: ISODate): Promise<void>
  clearExcludedDates(ruleId: string): Promise<void>

  getMeta(key: MetaKey): Promise<string | null>
  setMeta(key: MetaKey, value: string): Promise<void>

  /** Deja las finanzas como recién creadas: categorías iniciales y sin metadatos (solo pruebas). */
  reset(): Promise<void>
}
