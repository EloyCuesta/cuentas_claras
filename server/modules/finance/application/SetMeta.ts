import type { MetaKey } from '#shared/finance/meta.ts'
import type { UnitOfWork } from '../../../common/ports.ts'
import type { FinanceStore } from './ports.ts'

/** Guardar un dato auxiliar (la fecha de la última copia descargada). La clave y el valor llegan validados. */
export class SetMeta {
  private readonly store: FinanceStore
  private readonly unitOfWork: UnitOfWork

  constructor(store: FinanceStore, unitOfWork: UnitOfWork) {
    this.store = store
    this.unitOfWork = unitOfWork
  }

  execute(key: MetaKey, value: string): void {
    this.unitOfWork.run(() => this.store.setMeta(key, value))
  }
}
