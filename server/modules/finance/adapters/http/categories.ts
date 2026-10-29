import { Router } from 'express'
import { validateCategory } from '#shared/finance/backup.ts'
import { AppError } from '../../../../common/errors.ts'
import { sameId, valid } from '../../../../common/http/request.ts'
import { sendData } from '../../../../common/http/response.ts'
import type { DeleteCategory } from '../../application/DeleteCategory.ts'
import type { SaveCategory } from '../../application/SaveCategory.ts'

/**
 * - PUT /api/categories/:id                        crea o actualiza (nombre, orden, presupuesto…).
 * - DELETE /api/categories/:id?replacementId=…     elimina la categoría y sus subcategorías; sus
 *                                                  movimientos y recurrentes pasan a `replacementId`.
 */
export function categoryRoutes({
  saveCategory,
  deleteCategory,
}: {
  saveCategory: SaveCategory
  deleteCategory: DeleteCategory
}): Router {
  const router = Router()

  router.put('/categories/:id', (req, res) => {
    saveCategory.execute(sameId(valid(validateCategory(req.body)), req.params.id))
    sendData(res, null)
  })

  router.delete('/categories/:id', (req, res) => {
    const { replacementId } = req.query
    if (replacementId !== undefined && (typeof replacementId !== 'string' || replacementId === '')) {
      throw new AppError('VALIDATION', 'El parámetro «replacementId» no es válido.')
    }
    deleteCategory.execute(req.params.id, replacementId ?? null)
    sendData(res, null)
  })

  return router
}
