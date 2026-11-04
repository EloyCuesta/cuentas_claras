import type { ISODate } from '#shared/common/types.ts'
import { sortItems, sortPeople } from '#shared/pantry/pantry.ts'
import type { PantryEvent, PantryItem, PantryPerson, PantrySettings } from '#shared/pantry/types.ts'
import type { PantryRepository } from './ports.ts'

/**
 * Lecturas de la despensa: no cambian nada, así que no abren transacción
 * propia. Dentro de la de un caso de uso (comprar, deshacer, un ticket), leen
 * con esa misma transacción.
 */
export class PantryQueries {
  private readonly repository: PantryRepository

  constructor(repository: PantryRepository) {
    this.repository = repository
  }

  /** Por nombre. */
  async listPeople(): Promise<PantryPerson[]> {
    return sortPeople(await this.repository.listPeople())
  }

  /** Por frecuencia y nombre. */
  async listItems(): Promise<PantryItem[]> {
    return sortItems(await this.repository.listItems())
  }

  getItem(id: string): Promise<PantryItem | null> {
    return this.repository.getItem(id)
  }

  getSettings(): Promise<PantrySettings> {
    return this.repository.getSettings()
  }

  /** Revisiones desde una fecha (el historial de compras está en los tickets). */
  eventsSince(date: ISODate): Promise<PantryEvent[]> {
    return this.repository.eventsSince(date)
  }
}
