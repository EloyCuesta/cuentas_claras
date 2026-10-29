import type { Router } from 'express'
import type { ModuleDeps } from '../../common/modules.ts'
import { financeRoutes, type FinanceUseCases } from './adapters/http/routes.ts'
import { SqliteFinanceStore } from './adapters/sqlite/SqliteFinanceStore.ts'
import { DeleteCategory } from './application/DeleteCategory.ts'
import { DeleteMovement } from './application/DeleteMovement.ts'
import { DeleteRecurring } from './application/DeleteRecurring.ts'
import { GenerateOccurrences } from './application/GenerateOccurrences.ts'
import { ImportBrowserData } from './application/ImportBrowserData.ts'
import { FinanceQueries } from './application/queries.ts'
import { RestoreBackup } from './application/RestoreBackup.ts'
import { SaveCategory } from './application/SaveCategory.ts'
import { SaveMovement } from './application/SaveMovement.ts'
import { SaveRecurring } from './application/SaveRecurring.ts'
import { SetMeta } from './application/SetMeta.ts'

/**
 * Módulo finance: movimientos, categorías, recurrentes y sus vencimientos,
 * copias, importación del navegador y metadatos. Todo exige sesión.
 * API pública del módulo (ver AGENTS.md).
 */

export type { FinanceUseCases } from './adapters/http/routes.ts'

export interface FinanceModule {
  /** /api/data, /import, /movements, /categories, /recurring, /occurrences y /meta (con sesión). */
  router: Router
  /** Los casos de uso, para los tests del módulo (ningún otro módulo los usa). */
  useCases: FinanceUseCases
  /** Deja las finanzas como recién creadas (solo para POST /api/test/reset). */
  reset(): void
}

export function createFinanceModule({ db, clock, ids, unitOfWork }: ModuleDeps): FinanceModule {
  const store = new SqliteFinanceStore(db)
  const useCases: FinanceUseCases = {
    queries: new FinanceQueries(store, unitOfWork),
    saveMovement: new SaveMovement(store, unitOfWork),
    deleteMovement: new DeleteMovement(store, unitOfWork),
    saveCategory: new SaveCategory(store, unitOfWork),
    deleteCategory: new DeleteCategory(store, clock, unitOfWork),
    saveRecurring: new SaveRecurring(store, clock, ids, unitOfWork),
    deleteRecurring: new DeleteRecurring(store, unitOfWork),
    generateOccurrences: new GenerateOccurrences(store, clock, ids, unitOfWork),
    restoreBackup: new RestoreBackup(store, unitOfWork),
    importBrowserData: new ImportBrowserData(store, clock, unitOfWork),
    setMeta: new SetMeta(store, unitOfWork),
  }
  return { router: financeRoutes(useCases), useCases, reset: () => unitOfWork.run(() => store.reset()) }
}
