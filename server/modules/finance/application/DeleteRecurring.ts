import type { UnitOfWork } from '../../../common/ports.ts'
import type { FinanceStore } from './ports.ts'

/**
 * Eliminar un recurrente y sus vencimientos pendientes. Los pagados se
 * conservan, con su recurringId aunque el recurrente ya no exista (por eso
 * movements.recurring_id no es clave foránea).
 */
export class DeleteRecurring {
  private readonly store: FinanceStore
  private readonly unitOfWork: UnitOfWork

  constructor(store: FinanceStore, unitOfWork: UnitOfWork) {
    this.store = store
    this.unitOfWork = unitOfWork
  }

  execute(id: string): void {
    this.unitOfWork.run(() => {
      // Sus fechas excluidas se borran en cascada; los vencimientos pagados se conservan.
      this.store.deleteRule(id)
      this.store.deletePendingOfRule(id)
    })
  }
}
