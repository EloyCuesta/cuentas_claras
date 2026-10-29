import type { ISODate } from '#shared/common/types.ts'
import type { PantrySettings } from '#shared/pantry/types.ts'
import type { UnitOfWork } from '../../../common/ports.ts'
import type { PantryRepository } from './ports.ts'

/**
 * Apunta el día del repaso de la semana (la fecha de hoy del usuario). Se
 * guarda en el servidor, así que da igual desde qué móvil se haga. No toca el
 * presupuesto.
 */
export class SetReviewDate {
  private readonly repository: PantryRepository
  private readonly unitOfWork: UnitOfWork

  constructor(repository: PantryRepository, unitOfWork: UnitOfWork) {
    this.repository = repository
    this.unitOfWork = unitOfWork
  }

  execute(date: ISODate): PantrySettings {
    return this.unitOfWork.run(() => {
      this.repository.setReviewDate(date)
      return this.repository.getSettings()
    })
  }
}
