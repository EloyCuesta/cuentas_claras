import type { PantryItem, PantryItemInput } from '#shared/pantry/types.ts'
import type { Clock, UnitOfWork } from '../../../common/ports.ts'
import type { PantryRepository } from './ports.ts'
import { requireItem, requireOwner } from './require.ts'

/** Editar un producto: sube su versión (para que «Deshacer» no pise este cambio). */
export class UpdateItem {
  private readonly repository: PantryRepository
  private readonly clock: Clock
  private readonly unitOfWork: UnitOfWork

  constructor(repository: PantryRepository, clock: Clock, unitOfWork: UnitOfWork) {
    this.repository = repository
    this.clock = clock
    this.unitOfWork = unitOfWork
  }

  execute(id: string, input: PantryItemInput): PantryItem {
    return this.unitOfWork.run(() => {
      requireItem(this.repository, id)
      requireOwner(this.repository, input.ownerId)
      this.repository.updateItem(id, input, this.clock.nowISO())
      return requireItem(this.repository, id)
    })
  }
}
