import type { Category } from '#shared/finance/types.ts'
import { AppError } from '../../../common/errors.ts'
import type { UnitOfWork } from '../../../common/ports.ts'
import type { FinanceStore } from './ports.ts'

/**
 * Crear o actualizar una categoría (nombre, orden, presupuesto…). Reglas: un
 * solo nivel de subcategorías, del mismo tipo que su principal; una categoría
 * con subcategorías no pasa a ser subcategoría, y una categoría no cambia de
 * gastos a ingresos ni al revés.
 */
export class SaveCategory {
  private readonly store: FinanceStore
  private readonly unitOfWork: UnitOfWork

  constructor(store: FinanceStore, unitOfWork: UnitOfWork) {
    this.store = store
    this.unitOfWork = unitOfWork
  }

  execute(category: Category): void {
    this.unitOfWork.run(() => {
      if (category.parentId !== null) {
        const parent = this.store.getCategory(category.parentId)
        if (category.parentId === category.id || !parent) {
          throw new AppError('VALIDATION', 'La categoría principal no existe.')
        }
        if (parent.parentId !== null) throw new AppError('VALIDATION', 'Solo hay un nivel de subcategorías.')
        if (parent.type !== category.type) {
          throw new AppError('VALIDATION', 'La subcategoría debe ser del mismo tipo que su categoría principal.')
        }
        if (this.store.countChildren(category.id) > 0) {
          throw new AppError('VALIDATION', 'Una categoría con subcategorías no puede pasar a ser subcategoría.')
        }
      }
      const existing = this.store.getCategory(category.id)
      if (existing && existing.type !== category.type) {
        throw new AppError('CONFLICT', 'No se puede cambiar una categoría de gastos a ingresos ni al revés.')
      }
      this.store.upsertCategory(category)
    })
  }
}
