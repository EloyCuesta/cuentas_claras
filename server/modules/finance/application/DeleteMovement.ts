import type { UnitOfWork } from '../../../common/ports.ts'
import type { FinanceStore } from './ports.ts'

/**
 * Eliminar un movimiento. Si era un vencimiento de un recurrente que sigue
 * existiendo, se recuerda su fecha para no volver a crearlo. Si no existe, no
 * hace nada.
 */
export class DeleteMovement {
  private readonly store: FinanceStore
  private readonly unitOfWork: UnitOfWork

  constructor(store: FinanceStore, unitOfWork: UnitOfWork) {
    this.store = store
    this.unitOfWork = unitOfWork
  }

  execute(id: string): void {
    this.unitOfWork.run(() => {
      const movement = this.store.getMovement(id)
      if (!movement) return
      if (movement.recurringId && movement.occurrenceDate && this.store.hasRule(movement.recurringId)) {
        this.store.addExcludedDate(movement.recurringId, movement.occurrenceDate)
      }
      this.store.deleteMovement(id)
    })
  }
}
