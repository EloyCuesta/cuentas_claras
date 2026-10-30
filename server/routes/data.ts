import { Router } from 'express'
import { validateFinanceData } from '../../src/domain/backup.ts'
import { sendData, valid } from '../http.ts'
import type { SqliteFinanceRepository } from '../repository.ts'

/**
 * Todos los datos de una vez:
 * - GET /api/data          categorías, movimientos y recurrentes.
 * - PUT /api/data          sustituye todo (restaurar una copia de seguridad).
 */
export function dataRoutes(repository: SqliteFinanceRepository): Router {
  const router = Router()

  router.get('/data', async (_req, res) => {
    sendData(res, await repository.loadAll())
  })

  router.put('/data', async (req, res) => {
    await repository.replaceAll(valid(validateFinanceData(req.body)))
    sendData(res, null)
  })

  return router
}
