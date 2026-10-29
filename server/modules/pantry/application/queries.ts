import type { ISODate } from '#shared/common/types.ts'
import { sortItems, sortPeople } from '#shared/pantry/pantry.ts'
import type { PantryEvent, PantryItem, PantryPerson, PantrySettings } from '#shared/pantry/types.ts'
import type { PantryRepository } from './ports.ts'

/** Lecturas de la despensa: no cambian nada, así que no necesitan transacción. */
export class PantryQueries {
  private readonly repository: PantryRepository

  constructor(repository: PantryRepository) {
    this.repository = repository
  }

  /** Por nombre. */
  listPeople(): PantryPerson[] {
    return sortPeople(this.repository.listPeople())
  }

  /** Por frecuencia y nombre. */
  listItems(): PantryItem[] {
    return sortItems(this.repository.listItems())
  }

  getItem(id: string): PantryItem | null {
    return this.repository.getItem(id)
  }

  getSettings(): PantrySettings {
    return this.repository.getSettings()
  }

  /** Revisiones desde una fecha (el historial de compras está en los tickets). */
  eventsSince(date: ISODate): PantryEvent[] {
    return this.repository.eventsSince(date)
  }
}
