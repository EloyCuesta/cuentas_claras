import { AppError } from '../../../common/errors.ts'
import type { UnitOfWork } from '../../../common/ports.ts'
import type { TicketRepository } from './ports.ts'

/**
 * Borrar un ticket y sus líneas: sus compras dejan de contar para el ritmo.
 * Los productos creados con él, lo aprendido y las cantidades de los que se
 * cuentan se quedan como están.
 */
export class DeleteTicket {
  private readonly repository: TicketRepository
  private readonly unitOfWork: UnitOfWork

  constructor(repository: TicketRepository, unitOfWork: UnitOfWork) {
    this.repository = repository
    this.unitOfWork = unitOfWork
  }

  execute(id: string): void {
    this.unitOfWork.run(
      () => {
        if (!this.repository.getSummary(id)) throw new AppError('NOT_FOUND', 'Ese ticket ya no existe.')
        this.repository.deleteTicket(id)
      },
      { immediate: true },
    )
  }
}
