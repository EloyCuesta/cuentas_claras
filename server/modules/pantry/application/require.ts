import type { PantryItem, PantryPerson } from '#shared/pantry/types.ts'
import { AppError } from '../../../common/errors.ts'
import type { PantryRepository } from './ports.ts'

/** Comprobaciones que comparten varios casos de uso, con sus mensajes de siempre. */

export async function requirePerson(repository: PantryRepository, id: string): Promise<PantryPerson> {
  const person = await repository.getPerson(id)
  if (!person) throw new AppError('NOT_FOUND', 'Esa persona ya no existe. Vuelve a cargar la despensa.')
  return person
}

export async function requireItem(repository: PantryRepository, id: string): Promise<PantryItem> {
  const item = await repository.getItem(id)
  if (!item) throw new AppError('NOT_FOUND', 'Ese producto ya no existe. Vuelve a cargar la despensa.')
  return item
}

/** El dueño de un producto es Compartido (null) o una persona que existe. */
export async function requireOwner(repository: PantryRepository, ownerId: string | null): Promise<void> {
  if (ownerId !== null && !(await repository.getPerson(ownerId))) {
    throw new AppError('VALIDATION', 'El producto es de una persona que no existe. Elige otra o «Compartido».')
  }
}
