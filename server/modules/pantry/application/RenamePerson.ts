import type { PantryPerson } from '#shared/pantry/types.ts'
import type { UnitOfWork } from '../../../common/ports.ts'
import type { PantryRepository } from './ports.ts'
import { requirePerson } from './require.ts'

/** Cambiar el nombre de una persona (404 si ya no existe). */
export class RenamePerson {
  private readonly repository: PantryRepository
  private readonly unitOfWork: UnitOfWork

  constructor(repository: PantryRepository, unitOfWork: UnitOfWork) {
    this.repository = repository
    this.unitOfWork = unitOfWork
  }

  execute(id: string, name: string): PantryPerson {
    return this.unitOfWork.run(() => {
      requirePerson(this.repository, id)
      this.repository.renamePerson(id, name)
      return requirePerson(this.repository, id)
    })
  }
}
