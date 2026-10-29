import type { ISODate } from '#shared/common/types.ts'
import type { PantryItem, PantryPurchaseChange } from '#shared/pantry/types.ts'
import { AppError } from '../../../common/errors.ts'
import type { Clock, UnitOfWork } from '../../../common/ports.ts'
import type { AddEvent } from './AddEvent.ts'
import type { PantryRepository } from './ports.ts'
import type { PantryQueries } from './queries.ts'
import { requireItem } from './require.ts'

export interface PurchaseResult {
  /** Solo los productos que han cambiado (los que ya tenían su objetivo no se tocan). */
  changes: PantryPurchaseChange[]
  items: PantryItem[]
}

/**
 * «Marcar todo como comprado» desde la lista de la compra, con los valores
 * actuales del servidor. Si alguno no existe no se cambia nada (404).
 * - Los que se cuentan: quantity = target. Los que ya tienen su objetivo, o
 *   más, se dejan como están: comprar nunca reduce lo que hay.
 * - Los que se siguen por compras: se apunta «Lo he comprado» con la fecha
 *   indicada (la de hoy del usuario; si no llega, la del servidor).
 * Devuelve lo necesario para deshacerlo (UndoPurchase).
 */
export class MarkPurchased {
  private readonly repository: PantryRepository
  private readonly queries: PantryQueries
  private readonly addEvent: AddEvent
  private readonly clock: Clock
  private readonly unitOfWork: UnitOfWork

  constructor(repository: PantryRepository, queries: PantryQueries, addEvent: AddEvent, clock: Clock, unitOfWork: UnitOfWork) {
    this.repository = repository
    this.queries = queries
    this.addEvent = addEvent
    this.clock = clock
    this.unitOfWork = unitOfWork
  }

  execute(ids: readonly string[], date: ISODate | null = null): PurchaseResult {
    return this.unitOfWork.run(() => {
      const unique = [...new Set(ids)]
      const items = this.repository.getItems(unique)
      if (items.length !== unique.length) {
        throw new AppError('NOT_FOUND', 'Algún producto de la lista ya no existe. Vuelve a cargar la despensa; no se ha cambiado nada.')
      }
      const bought: PantryPurchaseChange[] = items
        .filter((item) => item.tracking === 'compras')
        .map((item) => ({ id: item.id, eventId: this.addEvent.execute(item.id, 'comprado', date ?? this.clock.today()).id }))
      const pending = items.filter((item) => item.tracking === 'cantidad' && item.quantity < item.target)
      // Una sola escritura para todos los productos que se cuentan.
      if (pending.length > 0) this.repository.fillToTarget(pending.map((item) => item.id), this.clock.nowISO())
      const changes: PantryPurchaseChange[] = [
        ...pending.map((item) => ({ id: item.id, previousQuantity: item.quantity, version: requireItem(this.repository, item.id).version })),
        ...bought,
      ]
      return { changes, items: this.queries.listItems() }
    })
  }
}
