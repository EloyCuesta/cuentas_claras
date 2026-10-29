import { Router } from 'express'
import type { DeleteCategory } from '../../application/DeleteCategory.ts'
import type { DeleteMovement } from '../../application/DeleteMovement.ts'
import type { DeleteRecurring } from '../../application/DeleteRecurring.ts'
import type { GenerateOccurrences } from '../../application/GenerateOccurrences.ts'
import type { ImportBrowserData } from '../../application/ImportBrowserData.ts'
import type { FinanceQueries } from '../../application/queries.ts'
import type { RestoreBackup } from '../../application/RestoreBackup.ts'
import type { SaveCategory } from '../../application/SaveCategory.ts'
import type { SaveMovement } from '../../application/SaveMovement.ts'
import type { SaveRecurring } from '../../application/SaveRecurring.ts'
import type { SetMeta } from '../../application/SetMeta.ts'
import { categoryRoutes } from './categories.ts'
import { dataRoutes } from './data.ts'
import { metaRoutes } from './meta.ts'
import { movementRoutes } from './movements.ts'
import { recurringRoutes } from './recurring.ts'

/** Los casos de uso y las lecturas de las finanzas: lo que usan sus rutas (y los tests del módulo). */
export interface FinanceUseCases {
  queries: FinanceQueries
  saveMovement: SaveMovement
  deleteMovement: DeleteMovement
  saveCategory: SaveCategory
  deleteCategory: DeleteCategory
  saveRecurring: SaveRecurring
  deleteRecurring: DeleteRecurring
  generateOccurrences: GenerateOccurrences
  restoreBackup: RestoreBackup
  importBrowserData: ImportBrowserData
  setMeta: SetMeta
}

/**
 * Todas las rutas financieras, en el orden de siempre: datos e importación,
 * movimientos, categorías, recurrentes y vencimientos, y metadatos. Exigen
 * sesión: app.ts monta este router después de requireAdmin.
 */
export function financeRoutes(useCases: FinanceUseCases): Router {
  const router = Router()
  router.use(dataRoutes(useCases))
  router.use(movementRoutes(useCases))
  router.use(categoryRoutes(useCases))
  router.use(recurringRoutes(useCases))
  router.use(metaRoutes(useCases))
  return router
}
