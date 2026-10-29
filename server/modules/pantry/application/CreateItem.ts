import type { PantryItem, PantryItemInput } from '#shared/pantry/types.ts'
import type { Clock, IdGenerator, UnitOfWork } from '../../../common/ports.ts'
import type { PantryRepository } from './ports.ts'
import { requireItem, requireOwner } from './require.ts'

/**
 * Crear un producto. El servidor pone el id, la versión (1) y las fechas. Lo
 * usan la ruta de productos y, a través de la API pública del módulo, los
 * tickets al guardar un producto nuevo.
 */
export class CreateItem {
  private readonly repository: PantryRepository
  private readonly clock: Clock
  private readonly ids: IdGenerator
  private readonly unitOfWork: UnitOfWork

  constructor(repository: PantryRepository, clock: Clock, ids: IdGenerator, unitOfWork: UnitOfWork) {
    this.repository = repository
    this.clock = clock
    this.ids = ids
    this.unitOfWork = unitOfWork
  }

  execute(input: PantryItemInput): PantryItem {
    return this.unitOfWork.run(() => {
      requireOwner(this.repository, input.ownerId)
      const id = this.ids.newId()
      this.repository.insertItem(id, input, this.clock.nowISO())
      return requireItem(this.repository, id)
    })
  }
}
