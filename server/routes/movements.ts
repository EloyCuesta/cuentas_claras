import { Router } from 'express'
import { validateMovement } from '../../src/domain/backup.ts'
import { sameId, sendData, valid } from '../http.ts'
import type { SqliteFinanceRepository } from '../repository.ts'

/**
 * - PUT /api/movements/:id     crea o actualiza un movimiento (marcar como pagado incluido).
 * - DELETE /api/movements/:id  lo elimina; si era un vencimiento, no se vuelve a generar.
 */
export function movementRoutes(repository: SqliteFinanceRepository): Router {
  const router = Router()

  router.put('/movements/:id', async (req, res) => {
    await repository.saveMovement(sameId(valid(validateMovement(req.body)), req.params.id))
    sendData(res, null)
  })

  router.delete('/movements/:id', async (req, res) => {
    await repository.deleteMovement(req.params.id)
    sendData(res, null)
  })

  return router
}
