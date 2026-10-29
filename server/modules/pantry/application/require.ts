import type { PantryItem, PantryPerson } from '#shared/pantry/types.ts'
import { AppError } from '../../../common/errors.ts'
import type { PantryRepository } from './ports.ts'

/** Comprobaciones que comparten varios casos de uso, con sus mensajes de siempre. */

export function requirePerson(repository: PantryRepository, id: string): PantryPerson {
  const person = repository.getPerson(id)
  if (!person) throw new AppError('NOT_FOUND', 'Esa persona ya no existe. Vuelve a cargar la despensa.')
  return person
}

export function requireItem(repository: PantryRepository, id: string): PantryItem {
  const item = repository.getItem(id)
  if (!item) throw new AppError('NOT_FOUND', 'Ese producto ya no existe. Vuelve a cargar la despensa.')
  return item
}

/** El dueño de un producto es Compartido (null) o una persona que existe. */
export function requireOwner(repository: PantryRepository, ownerId: string | null): void {
  if (ownerId !== null && !repository.getPerson(ownerId)) {
    throw new AppError('VALIDATION', 'El producto es de una persona que no existe. Elige otra o «Compartido».')
  }
}
