import type { ISODate } from '../../shared/common/types.ts'
import type { MetaKey } from '../../shared/finance/meta.ts'
import type { Category, FinanceData, Movement, RecurringRule, SaveRecurringOptions } from '../../shared/finance/types.ts'

/**
 * Contrato del almacenamiento. La interfaz de React solo conoce esta interfaz,
 * nunca IndexedDB directamente.
 *
 * Para migrar a una base de datos en servidor basta con escribir otra clase
 * que la implemente (por ejemplo, ApiFinanceRepository con fetch a una API
 * REST) y pasarla al <FinanceProvider> en main.tsx. Cada método corresponde a
 * una operación completa y atómica: o se guarda entera o no se guarda nada.
 */
export interface FinanceRepository {
  /** Todos los datos (categorías, movimientos y recurrentes). */
  loadAll(): Promise<FinanceData>

  /** Crea o actualiza un movimiento (mismo id = mismo movimiento). */
  saveMovement(movement: Movement): Promise<void>

  /** Elimina un movimiento. Si era un vencimiento de un recurrente, no se vuelve a generar. */
  deleteMovement(id: string): Promise<void>

  saveCategory(category: Category): Promise<void>

  /**
   * Elimina una categoría y sus subcategorías. Sus movimientos y recurrentes
   * pasan a `replacementId` (obligatorio si la categoría está en uso).
   */
  deleteCategory(id: string, replacementId: string | null): Promise<void>

  /**
   * Guarda un recurrente y rehace sus vencimientos pendientes hasta `horizon`.
   * Los vencimientos ya pagados no se modifican. Devuelve cuántos ha creado.
   */
  saveRecurring(rule: RecurringRule, options: SaveRecurringOptions): Promise<number>

  /** Elimina un recurrente y sus vencimientos pendientes. Los pagados se conservan. */
  deleteRecurring(id: string): Promise<void>

  /** Crea los vencimientos que falten hasta `horizon`. Nunca duplica. Devuelve cuántos ha creado. */
  generateOccurrences(horizon: ISODate): Promise<number>

  /** Sustituye todos los datos por los de una copia de seguridad. */
  replaceAll(data: FinanceData): Promise<void>

  getMeta(key: MetaKey): Promise<string | null>
  setMeta(key: MetaKey, value: string): Promise<void>
}
