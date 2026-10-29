import type { PantryPerson } from '#shared/pantry/types.ts'
import type { Clock, IdGenerator, UnitOfWork } from '../../../common/ports.ts'
import type { PantryRepository } from './ports.ts'

/** Añadir una persona de casa. El id y la fecha los pone el servidor. */
export class CreatePerson {
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

  /** `name` ya viene validado (sin espacios a los lados y de 1 a 40 caracteres). */
  execute(name: string): PantryPerson {
    return this.unitOfWork.run(() => {
      const person = { id: this.ids.newId(), name, createdAt: this.clock.nowISO() }
      this.repository.insertPerson(person)
      return person
    })
  }
}
