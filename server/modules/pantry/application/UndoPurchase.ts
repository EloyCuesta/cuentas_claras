import { checkQuantity } from '#shared/pantry/pantry.ts'
import type { PantryItem, PantryPurchaseChange } from '#shared/pantry/types.ts'
import { AppError } from '../../../common/errors.ts'
import type { Clock, UnitOfWork } from '../../../common/ports.ts'
import type { PantryRepository } from './ports.ts'
import type { PantryQueries } from './queries.ts'

/**
 * Deshacer una compra: cada producto que se cuenta vuelve a su cantidad
 * anterior y se borran las compras apuntadas. Solo si nada ha cambiado desde
 * entonces (misma versión, la compra sigue ahí); si no, 409 y no se toca nada,
 * para no pisar el cambio de otro móvil. Solo se restaura la cantidad, nunca
 * otros campos.
 */
export class UndoPurchase {
  private readonly repository: PantryRepository
  private readonly queries: PantryQueries
  private readonly clock: Clock
  private readonly unitOfWork: UnitOfWork

  constructor(repository: PantryRepository, queries: PantryQueries, clock: Clock, unitOfWork: UnitOfWork) {
    this.repository = repository
    this.queries = queries
    this.clock = clock
    this.unitOfWork = unitOfWork
  }

  execute(changes: readonly PantryPurchaseChange[]): PantryItem[] {
    return this.unitOfWork.run(() => {
      const conflict = () =>
        new AppError(
          'CONFLICT',
          'No se puede deshacer: algún producto ha cambiado o se ha borrado después de la compra (quizá desde otro dispositivo). No se ha tocado nada.',
        )
      // Primero se comprueba todo; después se escribe.
      const quantities: { id: string; quantity: number }[] = []
      const events: string[] = []
      for (const change of changes) {
        if ('eventId' in change) {
          const event = this.repository.getEvent(change.eventId)
          if (!event || event.itemId !== change.id || event.kind !== 'comprado') throw conflict()
          events.push(change.eventId)
          continue
        }
        const item = this.repository.getItem(change.id)
        if (!item || item.version !== change.version) throw conflict()
        const quantity = checkQuantity(change.previousQuantity, item.unit)
        if (!quantity.ok) throw new AppError('VALIDATION', quantity.error)
        quantities.push({ id: change.id, quantity: quantity.value })
      }
      const now = this.clock.nowISO()
      for (const { id, quantity } of quantities) this.repository.setQuantity(id, quantity, now)
      for (const id of events) this.repository.deleteEvent(id)
      return this.queries.listItems()
    })
  }
}
