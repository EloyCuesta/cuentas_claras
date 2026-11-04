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

  execute(id: string): Promise<void> {
    return this.unitOfWork.run(
      async () => {
        const movement = await this.store.getMovement(id)
        if (!movement) return
        if (movement.recurringId && movement.occurrenceDate && (await this.store.hasRule(movement.recurringId))) {
          await this.store.addExcludedDate(movement.recurringId, movement.occurrenceDate)
        }
        await this.store.deleteMovement(id)
      },
      { lock: 'finance' },
    )
  }
}
