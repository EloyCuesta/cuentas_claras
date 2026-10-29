import { Router } from 'express'
import { validateRecurring } from '#shared/finance/backup.ts'
import { readBody, readDate, readOptionalDate, sameId, valid } from '../../../../common/http/request.ts'
import { sendData } from '../../../../common/http/response.ts'
import type { DeleteRecurring } from '../../application/DeleteRecurring.ts'
import type { GenerateOccurrences } from '../../application/GenerateOccurrences.ts'
import type { SaveRecurring } from '../../application/SaveRecurring.ts'

/**
 * - PUT /api/recurring/:id          guarda el recurrente y rehace sus vencimientos pendientes.
 *                                   Cuerpo: { rule, horizon, markPaidBefore }. Devuelve { created }.
 * - DELETE /api/recurring/:id       lo elimina con sus pendientes (los pagados se conservan).
 * - POST /api/occurrences/generate  crea los vencimientos que falten hasta { horizon }. Devuelve { created }.
 *
 * El horizonte lo calcula la app con la fecha de hoy del usuario: el servidor no
 * depende de su propia zona horaria.
 */
export function recurringRoutes({
  saveRecurring,
  deleteRecurring,
  generateOccurrences,
}: {
  saveRecurring: SaveRecurring
  deleteRecurring: DeleteRecurring
  generateOccurrences: GenerateOccurrences
}): Router {
  const router = Router()

  router.put('/recurring/:id', (req, res) => {
    const body = readBody(req.body)
    const rule = sameId(valid(validateRecurring(body.rule)), req.params.id)
    const created = saveRecurring.execute(rule, {
      horizon: readDate(body.horizon, 'horizon'),
      markPaidBefore: readOptionalDate(body.markPaidBefore, 'markPaidBefore'),
    })
    sendData(res, { created })
  })

  router.delete('/recurring/:id', (req, res) => {
    deleteRecurring.execute(req.params.id)
    sendData(res, null)
  })

  router.post('/occurrences/generate', (req, res) => {
    const created = generateOccurrences.execute(readDate(readBody(req.body).horizon, 'horizon'))
    sendData(res, { created })
  })

  return router
}
