import { AppError } from '../../../common/errors.ts'
import type { UnitOfWork } from '../../../common/ports.ts'
import type { PantryRepository } from './ports.ts'

/** Deshacer una revisión desde el aviso («Deshacer») o desde el repaso de la semana. */
export class DeleteEvent {
  private readonly repository: PantryRepository
  private readonly unitOfWork: UnitOfWork

  constructor(repository: PantryRepository, unitOfWork: UnitOfWork) {
    this.repository = repository
    this.unitOfWork = unitOfWork
  }

  execute(id: string): Promise<void> {
    return this.unitOfWork.run(async () => {
      if (!(await this.repository.getEvent(id))) throw new AppError('NOT_FOUND', 'Esa revisión ya no existe.')
      await this.repository.deleteEvent(id)
    })
  }
}
