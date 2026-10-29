import { Router } from 'express'
import { validateFinanceData } from '../../shared/finance/backup.ts'
import { AppError } from '../errors.ts'
import { readBody, sendData, valid } from '../http.ts'
import type { SqliteFinanceRepository } from '../repository.ts'

/**
 * Todos los datos de una vez:
 * - GET /api/data          categorías, movimientos y recurrentes.
 * - PUT /api/data          sustituye todo (restaurar una copia de seguridad).
 * - POST /api/import       importa los datos que había en el navegador (solo si aquí no hay nada).
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

  router.post('/import', async (req, res) => {
    const body = readBody(req.body)
    const data = valid(validateFinanceData(body.data))
    const { lastBackupAt } = body
    if (lastBackupAt !== null && lastBackupAt !== undefined && typeof lastBackupAt !== 'string') {
      throw new AppError('VALIDATION', 'El campo «lastBackupAt» debe ser texto.')
    }
    sendData(res, await repository.importBrowserData(data, lastBackupAt ?? null), 201)
  })

  return router
}
