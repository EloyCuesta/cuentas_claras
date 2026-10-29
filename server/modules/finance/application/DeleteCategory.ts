import { withDescendants } from '#shared/finance/categories.ts'
import { AppError } from '../../../common/errors.ts'
import type { Clock, UnitOfWork } from '../../../common/ports.ts'
import type { FinanceStore } from './ports.ts'

/**
 * Eliminar una categoría y sus subcategorías. Si alguna está en uso, sus
 * movimientos y recurrentes pasan a `replacementId`, que entonces es
 * obligatoria (409 si falta) y debe ser del mismo tipo y no estar entre las
 * que se borran. Todo se comprueba antes de escribir nada.
 */
export class DeleteCategory {
  private readonly store: FinanceStore
  private readonly clock: Clock
  private readonly unitOfWork: UnitOfWork

  constructor(store: FinanceStore, clock: Clock, unitOfWork: UnitOfWork) {
    this.store = store
    this.clock = clock
    this.unitOfWork = unitOfWork
  }

  execute(id: string, replacementId: string | null): void {
    this.unitOfWork.run(() => {
      const all = this.store.listCategories()
      const removed = withDescendants(all, id)
      const target = all.find((c) => c.id === id)
      const replacement = replacementId ? all.find((c) => c.id === replacementId) : undefined
      // Las comprobaciones se hacen antes de escribir nada.
      if (target && replacementId && (!replacement || replacement.type !== target.type || removed.includes(replacementId))) {
        throw new AppError('VALIDATION', 'La categoría de destino no es válida.')
      }

      const affected = this.store.countCategoryUsage(removed)
      if (affected > 0 && !replacementId) {
        throw new AppError('CONFLICT', 'La categoría tiene movimientos: elige a qué categoría pasarlos.')
      }
      if (affected > 0 && replacementId) this.store.reassignCategories(removed, replacementId, this.clock.nowISO())
      this.store.deleteCategories(removed)
    })
  }
}
