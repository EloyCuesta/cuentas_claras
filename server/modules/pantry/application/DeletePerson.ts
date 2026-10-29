import { AppError } from '../../../common/errors.ts'
import type { UnitOfWork } from '../../../common/ports.ts'
import type { PantryRepository } from './ports.ts'
import { requirePerson } from './require.ts'

/**
 * Borrar una persona. Mientras tenga productos no se puede (409): primero hay
 * que pasarlos a otra persona o a «Compartido», o eliminarlos. La base de datos
 * lo impide también (owner_id con ON DELETE RESTRICT).
 */
export class DeletePerson {
  private readonly repository: PantryRepository
  private readonly unitOfWork: UnitOfWork

  constructor(repository: PantryRepository, unitOfWork: UnitOfWork) {
    this.repository = repository
    this.unitOfWork = unitOfWork
  }

  execute(id: string): void {
    this.unitOfWork.run(() => {
      const person = requirePerson(this.repository, id)
      const n = this.repository.countItemsOf(id)
      if (n > 0) {
        throw new AppError(
          'CONFLICT',
          `«${person.name}» tiene ${n === 1 ? 'un producto' : `${n} productos`}. Pásalos a otra persona o a «Compartido», o elimínalos, antes de borrarla.`,
        )
      }
      this.repository.deletePerson(id)
    })
  }
}
