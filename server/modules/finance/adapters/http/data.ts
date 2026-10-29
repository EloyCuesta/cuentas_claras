import { Router } from 'express'
import { validateFinanceData } from '#shared/finance/backup.ts'
import { AppError } from '../../../../common/errors.ts'
import { readBody, valid } from '../../../../common/http/request.ts'
import { sendData } from '../../../../common/http/response.ts'
import type { ImportBrowserData } from '../../application/ImportBrowserData.ts'
import type { FinanceQueries } from '../../application/queries.ts'
import type { RestoreBackup } from '../../application/RestoreBackup.ts'

/**
 * Todos los datos de una vez:
 * - GET /api/data          categorías, movimientos y recurrentes.
 * - PUT /api/data          sustituye todo (restaurar una copia de seguridad).
 * - POST /api/import       importa los datos que había en el navegador (solo si aquí no hay nada).
 */
export function dataRoutes({
  queries,
  restoreBackup,
  importBrowserData,
}: {
  queries: FinanceQueries
  restoreBackup: RestoreBackup
  importBrowserData: ImportBrowserData
}): Router {
  const router = Router()

  router.get('/data', (_req, res) => {
    sendData(res, queries.loadAll())
  })

  router.put('/data', (req, res) => {
    restoreBackup.execute(valid(validateFinanceData(req.body)))
    sendData(res, null)
  })

  router.post('/import', (req, res) => {
    const body = readBody(req.body)
    const data = valid(validateFinanceData(body.data))
    const { lastBackupAt } = body
    if (lastBackupAt !== null && lastBackupAt !== undefined && typeof lastBackupAt !== 'string') {
      throw new AppError('VALIDATION', 'El campo «lastBackupAt» debe ser texto.')
    }
    sendData(res, importBrowserData.execute(data, lastBackupAt ?? null), 201)
  })

  return router
}
