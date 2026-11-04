import type { UnitOfWork } from '../../../common/ports.ts'
import type { PantryRepository } from './ports.ts'
import { requireItem } from './require.ts'

/**
 * Borrar un producto (404 si ya no existe). Sus revisiones y lo aprendido se
 * borran con él; las líneas de los tickets se quedan, sin producto (lo hacen las
 * claves foráneas de la base de datos).
 */
export class DeleteItem {
  private readonly repository: PantryRepository
  private readonly unitOfWork: UnitOfWork

  constructor(repository: PantryRepository, unitOfWork: UnitOfWork) {
    this.repository = repository
    this.unitOfWork = unitOfWork
  }

  execute(id: string): Promise<void> {
    return this.unitOfWork.run(async () => {
      await this.repository.lockItems([id])
      await requireItem(this.repository, id)
      await this.repository.deleteItem(id)
    })
  }
}
