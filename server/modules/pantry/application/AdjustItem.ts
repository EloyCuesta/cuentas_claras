import { checkQuantity, stepQuantity } from '#shared/pantry/pantry.ts'
import type { PantryItem } from '#shared/pantry/types.ts'
import { AppError } from '../../../common/errors.ts'
import type { Clock, UnitOfWork } from '../../../common/ports.ts'
import type { PantryRepository } from './ports.ts'
import { requireItem } from './require.ts'

/**
 * Botones + y −: suma o resta sobre la cantidad que hay ahora en el servidor,
 * no sobre la que vio el móvil, así que dos móviles a la vez no se pisan.
 * Nunca baja de cero, y solo g, kg, ml y l admiten decimales.
 */
export class AdjustItem {
  private readonly repository: PantryRepository
  private readonly clock: Clock
  private readonly unitOfWork: UnitOfWork

  constructor(repository: PantryRepository, clock: Clock, unitOfWork: UnitOfWork) {
    this.repository = repository
    this.clock = clock
    this.unitOfWork = unitOfWork
  }

  execute(id: string, delta: number): PantryItem {
    return this.unitOfWork.run(() => {
      const item = requireItem(this.repository, id)
      const checked = checkQuantity(stepQuantity(item.quantity, delta), item.unit)
      if (!checked.ok) throw new AppError('VALIDATION', checked.error)
      this.repository.setQuantity(id, checked.value, this.clock.nowISO())
      return requireItem(this.repository, id)
    })
  }
}
