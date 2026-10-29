import type { MetaKey } from '#shared/finance/meta.ts'
import type { FinanceData } from '#shared/finance/types.ts'
import type { UnitOfWork } from '../../../common/ports.ts'
import type { FinanceStore } from './ports.ts'

/** Lecturas de las finanzas. */
export class FinanceQueries {
  private readonly store: FinanceStore
  private readonly unitOfWork: UnitOfWork

  constructor(store: FinanceStore, unitOfWork: UnitOfWork) {
    this.store = store
    this.unitOfWork = unitOfWork
  }

  /** Todas las categorías, movimientos y recurrentes, leídos en una transacción: una foto coherente. */
  loadAll(): FinanceData {
    return this.unitOfWork.run(() => this.store.readAll())
  }

  getMeta(key: MetaKey): string | null {
    return this.store.getMeta(key)
  }
}
