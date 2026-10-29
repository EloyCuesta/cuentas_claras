import { Router } from 'express'
import { validateRecurring } from '#shared/finance/backup.ts'
import { readBody, readDate, readOptionalDate, sameId, sendData, valid } from '../http.ts'
import type { SqliteFinanceRepository } from '../repository.ts'

/**
 * - PUT /api/recurring/:id          guarda el recurrente y rehace sus vencimientos pendientes.
 *                                   Cuerpo: { rule, horizon, markPaidBefore }. Devuelve { created }.
 * - DELETE /api/recurring/:id       lo elimina con sus pendientes (los pagados se conservan).
 * - POST /api/occurrences/generate  crea los vencimientos que falten hasta { horizon }. Devuelve { created }.
 *
 * El horizonte lo calcula la app con la fecha de hoy del usuario: el servidor no
 * depende de su propia zona horaria.
 */
export function recurringRoutes(repository: SqliteFinanceRepository): Router {
  const router = Router()

  router.put('/recurring/:id', async (req, res) => {
    const body = readBody(req.body)
    const rule = sameId(valid(validateRecurring(body.rule)), req.params.id)
    const created = await repository.saveRecurring(rule, {
      horizon: readDate(body.horizon, 'horizon'),
      markPaidBefore: readOptionalDate(body.markPaidBefore, 'markPaidBefore'),
    })
    sendData(res, { created })
  })

  router.delete('/recurring/:id', async (req, res) => {
    await repository.deleteRecurring(req.params.id)
    sendData(res, null)
  })

  router.post('/occurrences/generate', async (req, res) => {
    const created = await repository.generateOccurrences(readDate(readBody(req.body).horizon, 'horizon'))
    sendData(res, { created })
  })

  return router
}
