import { createHash, randomUUID } from 'node:crypto'
import { suggestForTicket, type TicketDraft } from '../../shared/tickets/match.ts'
import { linesFromText, parseTicket } from '../../shared/tickets/parse.ts'
import type { OcrLine } from '../../shared/tickets/types.ts'
import { AppError } from '../infra/errors.ts'
import type { SqlitePantryRepository } from '../pantry/repository.ts'
import type { TicketReader } from './ocr.ts'
import type { SqliteTicketRepository } from './repository.ts'
import type { TicketReadRequest } from './request.ts'

/**
 * Leer un ticket: OCR (o texto pegado) → ticket interpretado → qué producto
 * es cada línea según lo aprendido → si ya estaba guardado. No guarda nada.
 */
export class TicketService {
  private readonly tickets: SqliteTicketRepository
  private readonly pantry: SqlitePantryRepository
  private readonly reader: TicketReader

  constructor(tickets: SqliteTicketRepository, pantry: SqlitePantryRepository, reader: TicketReader) {
    this.tickets = tickets
    this.pantry = pantry
    this.reader = reader
  }

  async read(request: TicketReadRequest): Promise<TicketDraft> {
    const { pages, sourceFingerprint } = await this.recognize(request)
    const ticket = parseTicket(pages)
    if (ticket.lines.length === 0) {
      throw new AppError('VALIDATION', 'No se ha encontrado ningún producto en el ticket. Prueba con una captura más nítida o pega el texto.')
    }

    const suggestions = suggestForTicket(ticket.lines, this.tickets.aliases(ticket.store, ticket.storeName), this.pantry.listItems())
    const candidate = {
      ...ticket,
      date: ticket.date ?? request.today,
      lines: ticket.lines.map((line) => ({ ...line, occasional: false })),
    }
    const duplicate = this.tickets.findDuplicate({ ...candidate, sourceFingerprint })
    const possibleDuplicate = duplicate ? null : this.tickets.possibleDuplicate(candidate)
    return { ticket, suggestions: Object.fromEntries(suggestions), duplicate, possibleDuplicate, sourceFingerprint, importId: randomUUID() }
  }

  /** Las líneas de cada página y una huella del origen (para no leer dos veces lo mismo). */
  private async recognize(request: TicketReadRequest): Promise<{ pages: OcrLine[][]; sourceFingerprint: string }> {
    const hash = createHash('sha256')
    if (request.kind === 'text') {
      hash.update(request.text.normalize('NFC').replace(/\s+/g, ' ').trim())
      return { pages: [linesFromText(request.text)], sourceFingerprint: hash.digest('hex') }
    }
    for (const image of request.images) {
      hash.update(String(image.length))
      hash.update(image)
    }
    try {
      const pages = await this.reader.read(request.images, request.segments)
      return { pages, sourceFingerprint: hash.digest('hex') }
    } catch (error) {
      console.error('[api] No se ha podido leer el ticket:', error)
      throw new AppError('VALIDATION', 'No se ha podido leer la imagen. Prueba con otra captura más nítida.')
    }
  }
}
