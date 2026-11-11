import type { PantryItem, PantryItemInput } from '#shared/pantry/types.ts'
import { AppError } from '../../../common/errors.ts'
import type { Clock, UnitOfWork } from '../../../common/ports.ts'
import type { PantryRepository } from './ports.ts'
import { requireItem, requireOwner } from './require.ts'

/** El producto cambió desde que se abrió el formulario (otro móvil, un + o una compra): no se pisa. */
export const STALE_ITEM_MESSAGE =
  'Este producto ha cambiado desde que lo abriste (quizá desde otro dispositivo), así que no se ha guardado. Vuelve a cargarlo para ver cómo está ahora.'

/**
 * Editar un producto: solo si sigue en la versión con la que se abrió el
 * formulario (`expectedVersion`), y sube su versión (para que «Deshacer» y otra
 * edición no pisen este cambio). Orden: 404, 409 y después el dueño.
 */
export class UpdateItem {
  private readonly repository: PantryRepository
  private readonly clock: Clock
  private readonly unitOfWork: UnitOfWork

  constructor(repository: PantryRepository, clock: Clock, unitOfWork: UnitOfWork) {
    this.repository = repository
    this.clock = clock
    this.unitOfWork = unitOfWork
  }

  execute(id: string, input: PantryItemInput, expectedVersion: number): Promise<PantryItem> {
    return this.unitOfWork.run(async () => {
      await this.repository.lockItems([id])
      const current = await requireItem(this.repository, id)
      if (current.version !== expectedVersion) throw new AppError('CONFLICT', STALE_ITEM_MESSAGE)
      await requireOwner(this.repository, input.ownerId)
      await this.repository.updateItem(id, input, this.clock.nowISO())
      return requireItem(this.repository, id)
    })
  }
}
