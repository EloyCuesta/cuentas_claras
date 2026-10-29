import { Router } from 'express'
import { isValidISODate, todayISO } from '../../src/domain/dates.ts'
import { suggestForTicket, type TicketDraft } from '../../src/domain/ticketMatch.ts'
import { linesFromText, parseTicket } from '../../src/domain/ticketParse.ts'
import { validateLineUpdate, validateTicketSave } from '../../src/domain/ticketValidation.ts'
import type { OcrLine } from '../../src/domain/types.ts'
import { AppError } from '../errors.ts'
import { readBody, sendData, valid } from '../http.ts'
import { imageInfo } from '../imageInfo.ts'
import type { TicketReader } from '../ocr.ts'
import type { SqlitePantryRepository } from '../pantryRepository.ts'
import type { SqliteTicketRepository } from '../ticketRepository.ts'

const MAX_IMAGES = 6
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_PIXELS = 40_000_000
const MAX_TEXT = 20_000

function decodeImages(value: unknown): Buffer[] {
  if (!Array.isArray(value) || value.length === 0) throw new AppError('VALIDATION', 'Elige al menos una imagen del ticket.')
  if (value.length > MAX_IMAGES) throw new AppError('VALIDATION', `Se pueden leer como máximo ${MAX_IMAGES} imágenes de un mismo ticket.`)
  return value.map((item, i) => {
    if (typeof item !== 'string' || item.length === 0) throw new AppError('VALIDATION', `La imagen ${i + 1} no es válida.`)
    const buffer = Buffer.from(item.replace(/^data:[^,]*,/, ''), 'base64')
    if (buffer.length > MAX_IMAGE_BYTES) throw new AppError('VALIDATION', `La imagen ${i + 1} es demasiado grande (máximo 8 MB).`)
    const info = imageInfo(buffer)
    if (!info) throw new AppError('VALIDATION', `La imagen ${i + 1} no es una imagen PNG o JPEG.`)
    if (info.width * info.height > MAX_PIXELS || info.width > 8000 || info.height > 40000) {
      throw new AppError('VALIDATION', `La imagen ${i + 1} es demasiado grande para leerla.`)
    }
    return buffer
  })
}

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
export function ticketRoutes(tickets: SqliteTicketRepository, pantry: SqlitePantryRepository, reader: TicketReader): Router {
  const router = Router()

  router.post('/despensa/tickets/leer', async (req, res) => {
    const body = readBody(req.body)
    const today = isValidISODate(body.hoy) ? body.hoy : todayISO()
    let pages: OcrLine[][]
    if (typeof body.texto === 'string') {
      if (body.texto.trim() === '') throw new AppError('VALIDATION', 'Pega el texto del ticket.')
      if (body.texto.length > MAX_TEXT) throw new AppError('VALIDATION', 'El texto del ticket es demasiado largo.')
      pages = [linesFromText(body.texto)]
    } else {
      const images = decodeImages(body.imagenes)
      try {
        pages = await reader.read(images)
      } catch (error) {
        console.error('[api] No se ha podido leer el ticket:', error)
        throw new AppError('VALIDATION', 'No se ha podido leer la imagen. Prueba con otra captura más nítida.')
      }
    }
    const ticket = parseTicket(pages)
    if (ticket.lines.length === 0) {
      throw new AppError('VALIDATION', 'No se ha encontrado ningún producto en el ticket. Prueba con una captura más nítida o pega el texto.')
    }
    const items = pantry.listItems()
    const suggestions = suggestForTicket(ticket.lines, tickets.aliases(ticket.store, ticket.storeName), items)
    const duplicate = tickets.findDuplicate({
      store: ticket.store,
      storeName: ticket.storeName,
      date: ticket.date ?? today,
      time: ticket.time,
      totalCents: ticket.totalCents,
      lines: ticket.lines.map((line) => ({ ...line, occasional: false })),
    })
    sendData(res, { ticket, suggestions: Object.fromEntries(suggestions), duplicate } satisfies TicketDraft)
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
