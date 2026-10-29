import { Router } from 'express'
import { createHash, randomUUID } from 'node:crypto'
import { isValidISODate, todayISO } from '#shared/common/dates.ts'
import { suggestForTicket, type TicketDraft } from '#shared/tickets/ticketMatch.ts'
import { linesFromText, parseTicket } from '#shared/tickets/ticketParse.ts'
import { validateLineUpdate, validateTicketSave } from '#shared/tickets/ticketValidation.ts'
import type { OcrLine, TicketSegment } from '#shared/tickets/types.ts'
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

function decodeImages(value: unknown, max = MAX_IMAGES): Buffer[] {
  if (!Array.isArray(value) || value.length === 0) throw new AppError('VALIDATION', 'Elige al menos una imagen del ticket.')
  if (value.length > max) throw new AppError('VALIDATION', `Se pueden leer como máximo ${max} imágenes o franjas de un mismo ticket.`)
  let bytes = 0
  return value.map((item, i) => {
    if (typeof item !== 'string' || item.length === 0) throw new AppError('VALIDATION', `La imagen ${i + 1} no es válida.`)
    const buffer = Buffer.from(item.replace(/^data:[^,]*,/, ''), 'base64')
    bytes += buffer.length
    if (bytes > 20 * 1024 * 1024) throw new AppError('VALIDATION', 'Las imágenes superan 20 MB. Recorta los márgenes o el contenido publicitario.')
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
    const hash = createHash('sha256')
    if (typeof body.texto === 'string') {
      if (body.texto.trim() === '') throw new AppError('VALIDATION', 'Pega el texto del ticket.')
      if (body.texto.length > MAX_TEXT) throw new AppError('VALIDATION', 'El texto del ticket es demasiado largo.')
      pages = [linesFromText(body.texto)]
      hash.update(body.texto.normalize('NFC').replace(/\s+/g, ' ').trim())
    } else {
      let segments: Omit<TicketSegment, 'image'>[] | undefined
      let images: Buffer[]
      if (Array.isArray(body.franjas)) {
        images = decodeImages(body.franjas.map((f: unknown) => f && typeof f === 'object' ? (f as Record<string, unknown>).image : null), 24)
        const previous = new Map<number, { segment: number; offset: number; width: number; height: number }>()
        segments = body.franjas.map((raw: Record<string, unknown>, i: number) => {
          const { imageIndex, segmentIndex, offsetY, fullHeight } = raw
          if (![imageIndex, segmentIndex, offsetY, fullHeight].every(Number.isSafeInteger) || Number(imageIndex) < 0 || Number(imageIndex) > 5 ||
              Number(segmentIndex) < 0 || Number(segmentIndex) > 23 || Number(offsetY) < 0 || Number(fullHeight) < 1 || Number(fullHeight) > 160000) throw new AppError('VALIDATION', 'Las coordenadas de las franjas no son válidas.')
          const info = imageInfo(images[i])!
          const prev = previous.get(Number(imageIndex))
          if (info.height > 4096 || Number(offsetY) + info.height > Number(fullHeight) ||
            (prev ? Number(segmentIndex) !== prev.segment + 1 || Number(offsetY) <= prev.offset || info.width !== prev.width || Number(fullHeight) !== prev.height : segmentIndex !== 0 || offsetY !== 0)) {
            throw new AppError('VALIDATION', 'Las franjas deben estar ordenadas y pertenecer a la misma imagen.')
          }
          previous.set(Number(imageIndex), { segment: Number(segmentIndex), offset: Number(offsetY), width: info.width, height: Number(fullHeight) })
          return { imageIndex: Number(imageIndex), segmentIndex: Number(segmentIndex), offsetY: Number(offsetY), fullHeight: Number(fullHeight) }
        })
      } else images = decodeImages(body.imagenes)
      for (const image of images) { hash.update(String(image.length)); hash.update(image) }
      try {
        pages = await reader.read(images, segments)
      } catch (error) {
        console.error('[api] No se ha podido leer el ticket:', error)
        throw new AppError('VALIDATION', 'No se ha podido leer la imagen. Prueba con otra captura más nítida.')
      }
    }
    const ticket = parseTicket(pages)
    const sourceFingerprint = hash.digest('hex')
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
      adjustments: ticket.adjustments,
      sourceFingerprint,
    })
    const possibleDuplicate = duplicate ? null : tickets.possibleDuplicate({ ...ticket, date: ticket.date ?? today,
      lines: ticket.lines.map(line => ({ ...line, occasional: false })) })
    sendData(res, { ticket, suggestions: Object.fromEntries(suggestions), duplicate, possibleDuplicate, sourceFingerprint, importId: randomUUID() } satisfies TicketDraft)
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
