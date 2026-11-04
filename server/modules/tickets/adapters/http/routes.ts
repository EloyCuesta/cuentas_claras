import { Router } from 'express'
import { isValidISODate } from '#shared/common/dates.ts'
import { validateLineUpdate, validateTicketSave } from '#shared/tickets/ticketValidation.ts'
import { readBody, valid } from '../../../../common/http/request.ts'
import { sendData } from '../../../../common/http/response.ts'
import type { DeleteTicket } from '../../application/DeleteTicket.ts'
import type { TicketQueries } from '../../application/queries.ts'
import type { ReadTicket } from '../../application/ReadTicket.ts'
import type { SaveTicket } from '../../application/SaveTicket.ts'
import type { SetLineItem } from '../../application/SetLineItem.ts'
import { readTicketRequest } from './readTicketRequest.ts'

/** Lo que usan las rutas de los tickets. */
export interface TicketRouteDeps {
  queries: TicketQueries
  readTicket: ReadTicket
  saveTicket: SaveTicket
  setLineItem: SetLineItem
  deleteTicket: DeleteTicket
}

/**
 * Tickets de la compra (dentro de la despensa, públicos como ella):
 * - POST   /api/despensa/tickets/leer           { imagenes: [base64…] }, { franjas } o { texto }, y { hoy } → TicketDraft (no guarda nada)
 * - POST   /api/despensa/tickets                TicketSaveInput → 201 { ticket, items }; 409 si ya estaba guardado
 * - GET    /api/despensa/tickets                los últimos tickets (resumen)
 * - GET    /api/despensa/tickets/:id            un ticket con sus líneas
 * - PUT    /api/despensa/tickets/:id/lineas/:lineId  { itemId } → cambia el producto de esa línea (y de las iguales)
 * - DELETE /api/despensa/tickets/:id
 * - GET    /api/despensa/actividad?hoy=AAAA-MM-DD   compras y revisiones del último año, para el ritmo de compra
 */
export function ticketRoutes({ queries, readTicket, saveTicket, setLineItem, deleteTicket }: TicketRouteDeps): Router {
  const router = Router()

  router.post('/despensa/tickets/leer', async (req, res) => {
    const { source, today } = readTicketRequest(readBody(req.body))
    sendData(res, await readTicket.execute(source, today))
  })

  router.post('/despensa/tickets', async (req, res) => {
    sendData(res, await saveTicket.execute(valid(validateTicketSave(req.body))), 201)
  })

  router.get('/despensa/tickets', async (_req, res) => {
    sendData(res, await queries.listTickets())
  })

  router.get('/despensa/tickets/:id', async (req, res) => {
    sendData(res, await queries.getTicket(req.params.id))
  })

  router.put('/despensa/tickets/:id/lineas/:lineId', async (req, res) => {
    sendData(res, await setLineItem.execute(req.params.id, req.params.lineId, valid(validateLineUpdate(req.body)).itemId))
  })

  router.delete('/despensa/tickets/:id', async (req, res) => {
    await deleteTicket.execute(req.params.id)
    sendData(res, null)
  })

  router.get('/despensa/actividad', async (req, res) => {
    const { hoy } = req.query
    sendData(res, await queries.activity(isValidISODate(hoy) ? hoy : null))
  })

  return router
}
