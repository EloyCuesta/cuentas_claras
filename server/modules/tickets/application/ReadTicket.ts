import type { ISODate } from '#shared/common/types.ts'
import { suggestForTicket, type TicketDraft } from '#shared/tickets/ticketMatch.ts'
import { linesFromText, parseTicket } from '#shared/tickets/ticketParse.ts'
import type { OcrLine, TicketSegment } from '#shared/tickets/types.ts'
import { AppError } from '../../../common/errors.ts'
import type { Clock, IdGenerator } from '../../../common/ports.ts'
import { aliasStoreOf, imagesSource, pastedTextSource } from '../domain/ticketIdentity.ts'
import { findDuplicate, possibleDuplicate } from './duplicates.ts'
import type { Hasher, PantryGateway, TicketReader, TicketRepository } from './ports.ts'

/** Lo que se lee: el texto pegado, o las imágenes (o sus franjas, ya validadas por el router). */
export type TicketSourceInput =
  | { kind: 'texto'; text: string }
  | { kind: 'imagenes'; images: readonly Uint8Array[]; segments?: readonly Omit<TicketSegment, 'image'>[] }

/**
 * Leer un ticket sin guardar nada: el texto (con OCR local si son imágenes),
 * lo que se propone para cada producto (lo aprendido en esa tienda y los
 * nombres parecidos) y si ya estaba guardado.
 *
 * El total nunca decide un importe: lo hace parseTicket (shared/tickets). Si
 * el OCR falla, se explica con un 400 y el detalle sale en la consola.
 */
export class ReadTicket {
  private readonly repository: TicketRepository
  private readonly pantry: PantryGateway
  private readonly reader: TicketReader
  private readonly hasher: Hasher
  private readonly clock: Clock
  private readonly ids: IdGenerator

  constructor(
    repository: TicketRepository,
    pantry: PantryGateway,
    reader: TicketReader,
    hasher: Hasher,
    clock: Clock,
    ids: IdGenerator,
  ) {
    this.repository = repository
    this.pantry = pantry
    this.reader = reader
    this.hasher = hasher
    this.clock = clock
    this.ids = ids
  }

  /** `hoy` es la fecha de hoy del navegador (la de un ticket sin fecha); sin ella, la del servidor. */
  async execute(source: TicketSourceInput, hoy: ISODate | null): Promise<TicketDraft> {
    const today = hoy ?? this.clock.today()
    let pages: OcrLine[][]
    let sourceFingerprint: string
    if (source.kind === 'texto') {
      pages = [linesFromText(source.text)]
      sourceFingerprint = this.hasher.sha256Hex([pastedTextSource(source.text)])
    } else {
      sourceFingerprint = this.hasher.sha256Hex(imagesSource(source.images))
      try {
        pages = await this.reader.read(source.images, source.segments)
      } catch (error) {
        console.error('[api] No se ha podido leer el ticket:', error)
        throw new AppError('VALIDATION', 'No se ha podido leer la imagen. Prueba con otra captura más nítida.')
      }
    }

    const ticket = parseTicket(pages)
    if (ticket.lines.length === 0) {
      throw new AppError('VALIDATION', 'No se ha encontrado ningún producto en el ticket. Prueba con una captura más nítida o pega el texto.')
    }
    const suggestions = suggestForTicket(ticket.lines, this.repository.aliases(aliasStoreOf(ticket.store, ticket.storeName)), this.pantry.listItems())
    const lines = ticket.lines.map((line) => ({ ...line, occasional: false }))
    const duplicate = findDuplicate(this.repository, this.hasher, {
      store: ticket.store,
      storeName: ticket.storeName,
      date: ticket.date ?? today,
      time: ticket.time,
      totalCents: ticket.totalCents,
      lines,
      adjustments: ticket.adjustments,
      sourceFingerprint,
    })
    const possible = duplicate ? null : possibleDuplicate(this.repository, { ...ticket, date: ticket.date ?? today })
    return {
      ticket,
      suggestions: Object.fromEntries(suggestions),
      duplicate,
      possibleDuplicate: possible,
      sourceFingerprint,
      importId: this.ids.newId(),
    }
  }
}
