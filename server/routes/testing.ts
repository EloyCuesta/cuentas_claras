import { Router } from 'express'
import { sendData } from '../http.ts'
import type { SqliteFinanceRepository } from '../repository.ts'

/**
 * POST /api/test/reset: deja la base de datos como recién creada antes de cada
 * prueba en navegador. Solo existe si el servidor se arranca con CUENTAS_TEST=1
 * (lo hace playwright.config.ts con una base de datos aparte), nunca con npm run dev.
 */
export function testingRoutes(repository: SqliteFinanceRepository): Router {
  const router = Router()
  router.post('/test/reset', async (_req, res) => {
    await repository.reset()
    sendData(res, null)
  })
  return router
}
