import { Router } from 'express'
import type { SqliteFinanceRepository } from '../finance/repository.ts'
import type { SqlitePantryRepository } from '../pantry/repository.ts'
import { sendData } from './http.ts'

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
