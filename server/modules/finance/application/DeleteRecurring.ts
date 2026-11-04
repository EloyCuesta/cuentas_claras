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

  execute(id: string): Promise<void> {
    return this.unitOfWork.run(
      async () => {
        // Sus fechas excluidas se borran en cascada; los vencimientos pagados se conservan.
        await this.store.deleteRule(id)
        await this.store.deletePendingOfRule(id)
      },
      { lock: 'finance' },
    )
  }
}
