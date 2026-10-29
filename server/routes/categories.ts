import { Router } from 'express'
import { validateCategory } from '#shared/finance/backup.ts'
import { AppError } from '../common/errors.ts'
import { sameId, valid } from '../common/http/request.ts'
import { sendData } from '../common/http/response.ts'
import type { SqliteFinanceRepository } from '../repository.ts'

/**
 * - PUT /api/categories/:id                        crea o actualiza (nombre, orden, presupuesto…).
 * - DELETE /api/categories/:id?replacementId=…     elimina la categoría y sus subcategorías; sus
 *                                                  movimientos y recurrentes pasan a `replacementId`.
 */
export function categoryRoutes(repository: SqliteFinanceRepository): Router {
  const router = Router()

  router.put('/categories/:id', async (req, res) => {
    await repository.saveCategory(sameId(valid(validateCategory(req.body)), req.params.id))
    sendData(res, null)
  })

  router.delete('/categories/:id', async (req, res) => {
    const { replacementId } = req.query
    if (replacementId !== undefined && (typeof replacementId !== 'string' || replacementId === '')) {
      throw new AppError('VALIDATION', 'El parámetro «replacementId» no es válido.')
    }
    await repository.deleteCategory(req.params.id, replacementId ?? null)
    sendData(res, null)
  })

  return router
}
