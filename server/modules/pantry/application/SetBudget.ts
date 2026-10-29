import type { PantrySettings } from '#shared/pantry/types.ts'
import type { UnitOfWork } from '../../../common/ports.ts'
import type { PantryRepository } from './ports.ts'

/**
 * Presupuesto mensual de la despensa (null = sin presupuesto; 0 es un
 * presupuesto). Es solo para compararlo con la estimación: no crea nada en las
 * finanzas. No toca el día del último repaso.
 */
export class SetBudget {
  private readonly repository: PantryRepository
  private readonly unitOfWork: UnitOfWork

  constructor(repository: PantryRepository, unitOfWork: UnitOfWork) {
    this.repository = repository
    this.unitOfWork = unitOfWork
  }

  execute(monthlyBudgetCents: number | null): PantrySettings {
    return this.unitOfWork.run(() => {
      this.repository.setBudget(monthlyBudgetCents)
      return this.repository.getSettings()
    })
  }
}
