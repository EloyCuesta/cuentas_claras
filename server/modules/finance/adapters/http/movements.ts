import { Router } from 'express'
import { validateMovement } from '#shared/finance/backup.ts'
import { sameId, valid } from '../../../../common/http/request.ts'
import { sendData } from '../../../../common/http/response.ts'
import type { DeleteMovement } from '../../application/DeleteMovement.ts'
import type { SaveMovement } from '../../application/SaveMovement.ts'

/**
 * - PUT /api/movements/:id     crea o actualiza un movimiento (marcar como pagado incluido).
 * - DELETE /api/movements/:id  lo elimina; si era un vencimiento, no se vuelve a generar.
 */
export function movementRoutes({
  saveMovement,
  deleteMovement,
}: {
  saveMovement: SaveMovement
  deleteMovement: DeleteMovement
}): Router {
  const router = Router()

  router.put('/movements/:id', (req, res) => {
    saveMovement.execute(sameId(valid(validateMovement(req.body)), req.params.id))
    sendData(res, null)
  })

  router.delete('/movements/:id', (req, res) => {
    deleteMovement.execute(req.params.id)
    sendData(res, null)
  })

  return router
}
