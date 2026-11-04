import type { ISODate } from '#shared/common/types.ts'
import type { PantryEvent, PantryItem, PantryItemInput, PantryPerson, PantrySettings } from '#shared/pantry/types.ts'

/**
 * Persistencia de la despensa: personas, productos, revisiones y ajustes.
 *
 * Async (MySQL): los casos de uso la llaman dentro de UnitOfWork.run. Solo
 * guarda y lee; las comprobaciones y los mensajes de error están en los casos
 * de uso. Las listas salen sin ordenar: las ordena queries.ts con las reglas
 * de shared/pantry.
 */
export interface PantryRepository {
  listPeople(): Promise<PantryPerson[]>
  getPerson(id: string): Promise<PantryPerson | null>
  insertPerson(person: PantryPerson): Promise<void>
  renamePerson(id: string, name: string): Promise<void>
  deletePerson(id: string): Promise<void>
  /** Productos de una persona (no se puede borrar mientras tenga alguno). */
  countItemsOf(personId: string): Promise<number>

  /**
   * Bloquea las filas de esos productos hasta que termine la transacción
   * (SELECT … FOR UPDATE, en orden de id): otra escritura sobre ellos espera.
   * Va antes que cualquier otra lectura de la transacción, para que lo que se
   * lea después incluya lo que otra confirmó antes. Los ids que no existen se
   * saltan.
   */
  lockItems(ids: readonly string[]): Promise<void>
  listItems(): Promise<PantryItem[]>
  getItem(id: string): Promise<PantryItem | null>
  /** Los productos de esos ids que existen (para comprar varios a la vez), en orden de id. */
  getItems(ids: readonly string[]): Promise<PantryItem[]>
  /** Versión 1, createdAt = updatedAt = now. */
  insertItem(id: string, input: PantryItemInput, now: string): Promise<void>
  /** Sube la versión y pone updatedAt = now; createdAt no cambia. */
  updateItem(id: string, input: PantryItemInput, now: string): Promise<void>
  setQuantity(id: string, quantity: number, now: string): Promise<void>
  setPrice(id: string, priceCents: number, now: string): Promise<void>
  /** Completa hasta el objetivo los que tengan menos, con una sola escritura. */
  fillToTarget(ids: readonly string[], now: string): Promise<void>
  deleteItem(id: string): Promise<void>

  insertEvent(event: PantryEvent): Promise<void>
  getEvent(id: string): Promise<PantryEvent | null>
  deleteEvent(id: string): Promise<void>
  /** Revisiones desde una fecha, en orden (fecha, momento en que se apuntaron e id). */
  eventsSince(date: ISODate): Promise<PantryEvent[]>

  getSettings(): Promise<PantrySettings>
  setBudget(monthlyBudgetCents: number | null): Promise<void>
  setReviewDate(date: ISODate): Promise<void>

  /** Vacía la despensa (solo para las pruebas). */
  reset(): Promise<void>
}
