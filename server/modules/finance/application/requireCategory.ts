import type { MovementType } from '#shared/finance/types.ts'
import { AppError } from '../../../common/errors.ts'
import type { FinanceStore } from './ports.ts'

const typeLabel = (type: MovementType) => (type === 'gasto' ? 'gastos' : 'ingresos')

/**
 * Un movimiento o un recurrente debe usar una categoría que exista y sea de su
 * mismo tipo. `label` empieza el mensaje: «El movimiento», «El recurrente».
 */
export function requireCategory(store: FinanceStore, categoryId: string, type: MovementType, label: string): void {
  const category = store.getCategory(categoryId)
  if (!category) throw new AppError('VALIDATION', `${label} usa una categoría que no existe.`)
  if (category.type !== type) {
    throw new AppError('VALIDATION', `${label} es de ${typeLabel(type)}, pero su categoría es de ${typeLabel(category.type)}.`)
  }
}
