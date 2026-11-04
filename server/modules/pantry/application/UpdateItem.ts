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

  execute(id: string, input: PantryItemInput): Promise<PantryItem> {
    return this.unitOfWork.run(async () => {
      await this.repository.lockItems([id])
      await requireItem(this.repository, id)
      await requireOwner(this.repository, input.ownerId)
      await this.repository.updateItem(id, input, this.clock.nowISO())
      return requireItem(this.repository, id)
    })
  }
}
