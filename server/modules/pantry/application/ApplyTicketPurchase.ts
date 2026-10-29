import { checkQuantity } from '#shared/pantry/pantry.ts'
import type { Clock, UnitOfWork } from '../../../common/ports.ts'
import type { PantryRepository } from './ports.ts'
import { requireItem } from './require.ts'

export interface TicketPurchase {
  /** Nuevo precio por unidad (o por kilo), o null si el ticket no permite saberlo. */
  priceCents: number | null
  /** Cuánto se compró en la unidad del producto, o null si no se sabe. */
  addQuantity: number | null
}

/**
 * Lo que deja un ticket guardado en un producto que ya existía: el precio nuevo
 * y, si el producto se cuenta, lo comprado. Cada cambio sube la versión. Lo
 * llama el módulo tickets dentro de su transacción (aquí queda anidada).
 */
export class ApplyTicketPurchase {
  private readonly repository: PantryRepository
  private readonly clock: Clock
  private readonly unitOfWork: UnitOfWork

  constructor(repository: PantryRepository, clock: Clock, unitOfWork: UnitOfWork) {
    this.repository = repository
    this.clock = clock
    this.unitOfWork = unitOfWork
  }

  execute(id: string, { priceCents, addQuantity }: TicketPurchase): void {
    this.unitOfWork.run(() => {
      const item = requireItem(this.repository, id)
      const now = this.clock.nowISO()
      if (priceCents !== null && priceCents !== item.priceCents) this.repository.setPrice(id, priceCents, now)
      if (addQuantity !== null && addQuantity > 0 && item.tracking === 'cantidad') {
        const checked = checkQuantity(Math.round((item.quantity + addQuantity) * 1000) / 1000, item.unit)
        if (checked.ok) this.repository.setQuantity(id, checked.value, now)
      }
    })
  }
}
