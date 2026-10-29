import type { ISODate } from '#shared/common/types.ts'
import type { PantryEvent, PantryItem, PantryItemInput, PantryPerson, PantrySettings } from '#shared/pantry/types.ts'

/**
 * Persistencia de la despensa: personas, productos, revisiones y ajustes.
 *
 * Síncrona a propósito (better-sqlite3): los casos de uso la llaman dentro de
 * UnitOfWork.run. Solo guarda y lee; las comprobaciones y los mensajes de
 * error están en los casos de uso. Las listas salen sin ordenar: las ordena
 * queries.ts con las reglas de shared/pantry.
 */
export interface PantryRepository {
  listPeople(): PantryPerson[]
  getPerson(id: string): PantryPerson | null
  insertPerson(person: PantryPerson): void
  renamePerson(id: string, name: string): void
  deletePerson(id: string): void
  /** Productos de una persona (no se puede borrar mientras tenga alguno). */
  countItemsOf(personId: string): number

  listItems(): PantryItem[]
  getItem(id: string): PantryItem | null
  /** Los productos de esos ids que existen (para comprar varios a la vez). */
  getItems(ids: readonly string[]): PantryItem[]
  /** Versión 1, createdAt = updatedAt = now. */
  insertItem(id: string, input: PantryItemInput, now: string): void
  /** Sube la versión y pone updatedAt = now; createdAt no cambia. */
  updateItem(id: string, input: PantryItemInput, now: string): void
  setQuantity(id: string, quantity: number, now: string): void
  setPrice(id: string, priceCents: number, now: string): void
  /** Completa hasta el objetivo los que tengan menos, con una sola escritura. */
  fillToTarget(ids: readonly string[], now: string): void
  deleteItem(id: string): void

  insertEvent(event: PantryEvent): void
  getEvent(id: string): PantryEvent | null
  deleteEvent(id: string): void
  /** Revisiones desde una fecha, en orden (fecha y momento en que se apuntaron). */
  eventsSince(date: ISODate): PantryEvent[]

  getSettings(): PantrySettings
  setBudget(monthlyBudgetCents: number | null): void
  setReviewDate(date: ISODate): void

  /** Vacía la despensa (solo para las pruebas). */
  reset(): void
}
