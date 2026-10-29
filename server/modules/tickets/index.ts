import type { Router } from 'express'
import type { ModuleDeps } from '../../common/modules.ts'
import { Sha256Hasher } from './adapters/crypto/Sha256Hasher.ts'
import { ticketRoutes } from './adapters/http/routes.ts'
import { SqliteTicketRepository } from './adapters/sqlite/SqliteTicketRepository.ts'
import { DeleteTicket } from './application/DeleteTicket.ts'
import type { PantryGateway, TicketReader } from './application/ports.ts'
import { TicketQueries } from './application/queries.ts'
import { ReadTicket } from './application/ReadTicket.ts'
import { SaveTicket } from './application/SaveTicket.ts'
import { SetLineItem } from './application/SetLineItem.ts'

/**
 * Módulo tickets: leer los tickets de la compra (OCR local), guardarlos, lo
 * aprendido en cada tienda, el historial y la actividad para el ritmo de compra.
 * API pública del módulo (ver AGENTS.md).
 */

export type { PantryGateway, TicketReader } from './application/ports.ts'
export { createTesseractReader } from './adapters/tesseract/TesseractTicketReader.ts'

export interface TicketsModule {
  /** /api/despensa/tickets…, /tickets/leer y /actividad (públicas, como la despensa). */
  router: Router
  /** Vacía los tickets y lo aprendido (solo para POST /api/test/reset; antes que la despensa). */
  reset(): void
}

export function createTicketsModule({
  db,
  clock,
  ids,
  unitOfWork,
  pantry,
  reader,
}: ModuleDeps & { pantry: PantryGateway; reader: TicketReader }): TicketsModule {
  const repository = new SqliteTicketRepository(db)
  const hasher = new Sha256Hasher()
  const queries = new TicketQueries(repository, pantry, clock)
  const router = ticketRoutes({
    queries,
    readTicket: new ReadTicket(repository, pantry, reader, hasher, clock, ids),
    saveTicket: new SaveTicket(repository, pantry, queries, hasher, clock, ids, unitOfWork),
    setLineItem: new SetLineItem(repository, pantry, queries, clock, unitOfWork),
    deleteTicket: new DeleteTicket(repository, unitOfWork),
  })
  return { router, reset: () => unitOfWork.run(() => repository.reset()) }
}
