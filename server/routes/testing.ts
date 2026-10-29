import { Router } from 'express'
import { sendData } from '../http.ts'
import type { SqlitePantryRepository } from '../pantryRepository.ts'
import type { SqliteFinanceRepository } from '../repository.ts'

/**
 * POST /api/test/reset: deja la base de datos como recién creada antes de cada
 * prueba en navegador, despensa incluida. Solo existe si el servidor se arranca
 * con CUENTAS_TEST=1 (lo hace playwright.config.ts con una base de datos aparte),
 * nunca con npm run dev. Como el resto de rutas financieras, exige sesión.
 */
export function testingRoutes(repository: SqliteFinanceRepository, pantry: SqlitePantryRepository): Router {
  const router = Router()
  router.post('/test/reset', async (_req, res) => {
    await repository.reset()
    pantry.reset()
    sendData(res, null)
  })
  return router
}
