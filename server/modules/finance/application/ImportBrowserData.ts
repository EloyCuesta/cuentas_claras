import { hasUserData } from '#shared/finance/backup.ts'
import type { FinanceData } from '#shared/finance/types.ts'
import { AppError } from '../../../common/errors.ts'
import type { Clock, UnitOfWork } from '../../../common/ports.ts'
import type { FinanceStore } from './ports.ts'

export interface ImportSummary {
  categories: number
  movements: number
  recurring: number
}

/**
 * Importar los datos que había en el navegador (versiones anteriores, con
 * IndexedDB), solo si aquí todavía no hay nada del usuario: así nunca se
 * mezclan ni se duplican (409 si ya hay datos). Conserva la fecha de la
 * última copia, si no había otra, y anota cuándo se importó.
 */
export class ImportBrowserData {
  private readonly store: FinanceStore
  private readonly clock: Clock
  private readonly unitOfWork: UnitOfWork

  constructor(store: FinanceStore, clock: Clock, unitOfWork: UnitOfWork) {
    this.store = store
    this.clock = clock
    this.unitOfWork = unitOfWork
  }

  execute(data: FinanceData, lastBackupAt: string | null): ImportSummary {
    return this.unitOfWork.run(() => {
      if (hasUserData(this.store.readAll())) {
        throw new AppError('CONFLICT', 'La base de datos ya tiene datos, así que no se han importado los del navegador.')
      }
      this.store.writeAll(data)
      if (lastBackupAt && !this.store.getMeta('lastBackupAt')) this.store.setMeta('lastBackupAt', lastBackupAt)
      this.store.setMeta('browserImportAt', this.clock.nowISO())
      return { categories: data.categories.length, movements: data.movements.length, recurring: data.recurring.length }
    })
  }
}
