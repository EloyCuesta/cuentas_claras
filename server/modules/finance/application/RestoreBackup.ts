import type { FinanceData } from '#shared/finance/types.ts'
import type { UnitOfWork } from '../../../common/ports.ts'
import type { FinanceStore } from './ports.ts'

/**
 * Restaurar una copia de seguridad: sustituye todas las finanzas, entero o
 * nada. La copia llega ya validada con las mismas reglas que en la web
 * (validateFinanceData); si aun así algo no encaja (una clave foránea), no
 * cambia nada. No toca la despensa ni los metadatos.
 */
export class RestoreBackup {
  private readonly store: FinanceStore
  private readonly unitOfWork: UnitOfWork

  constructor(store: FinanceStore, unitOfWork: UnitOfWork) {
    this.store = store
    this.unitOfWork = unitOfWork
  }

  execute(data: FinanceData): void {
    this.unitOfWork.run(() => this.store.writeAll(data))
  }
}
