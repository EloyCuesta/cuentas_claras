import { Router } from 'express'
import { isValidISODate, todayISO } from '../../shared/core/dates.ts'
import { validateLineUpdate, validateTicketSave } from '../../shared/tickets/validation.ts'
import { sendData, valid } from '../infra/http.ts'
import type { SqliteTicketRepository } from './repository.ts'
import { parseTicketReadRequest } from './request.ts'
import type { TicketService } from './service.ts'

/**
 * Tickets de la compra (dentro de la despensa, públicos como ella):
 * - POST   /api/despensa/tickets/leer           { imagenes: [base64…] } o { texto }, y { hoy } → TicketDraft (no guarda nada)
 * - POST   /api/despensa/tickets                TicketSaveInput → 201 { ticket, items }; 409 si ya estaba guardado
 * - GET    /api/despensa/tickets                los últimos tickets (resumen)
 * - GET    /api/despensa/tickets/:id            un ticket con sus líneas
 * - PUT    /api/despensa/tickets/:id/lineas/:lineId  { itemId } → cambia el producto de esa línea (y de las iguales)
 * - DELETE /api/despensa/tickets/:id
 * - GET    /api/despensa/actividad?hoy=AAAA-MM-DD   compras y revisiones del último año, para el ritmo de compra
 */
export function ticketRoutes(tickets: SqliteTicketRepository, service: TicketService): Router {
  const router = Router()

  router.post('/despensa/tickets/leer', async (req, res) => {
    sendData(res, await service.read(parseTicketReadRequest(req.body)))
  })

  router.post('/despensa/tickets', (req, res) => {
    sendData(res, tickets.saveTicket(valid(validateTicketSave(req.body))), 201)
  })

  router.get('/despensa/tickets', (_req, res) => {
    sendData(res, tickets.listTickets())
  })

  router.get('/despensa/tickets/:id', (req, res) => {
    sendData(res, tickets.getTicket(req.params.id))
  })

  router.put('/despensa/tickets/:id/lineas/:lineId', (req, res) => {
    sendData(res, tickets.setLineItem(req.params.id, req.params.lineId, valid(validateLineUpdate(req.body)).itemId))
  })

  router.delete('/despensa/tickets/:id', (req, res) => {
    tickets.deleteTicket(req.params.id)
    sendData(res, null)
  })

  router.get('/despensa/actividad', (req, res) => {
    const { hoy } = req.query
    sendData(res, tickets.activity(400, isValidISODate(hoy) ? hoy : todayISO()))
  })

  return router
}
