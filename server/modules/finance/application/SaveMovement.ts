import type { Movement } from '#shared/finance/types.ts'
import type { UnitOfWork } from '../../../common/ports.ts'
import type { FinanceStore } from './ports.ts'
import { requireCategory } from './requireCategory.ts'

/**
 * Crear o actualizar un movimiento (mismo id = mismo movimiento). Marcar como
 * pagado es esto mismo: cambia el estado y la fecha de pago, no crea otro.
 * 409 si se convertiría en un vencimiento que ya existe.
 */
export class SaveMovement {
  private readonly store: FinanceStore
  private readonly unitOfWork: UnitOfWork

  constructor(store: FinanceStore, unitOfWork: UnitOfWork) {
    this.store = store
    this.unitOfWork = unitOfWork
  }

  execute(movement: Movement): void {
    this.unitOfWork.run(() => {
      requireCategory(this.store, movement.categoryId, movement.type, 'El movimiento')
      this.store.upsertMovement(movement)
    })
  }
}
