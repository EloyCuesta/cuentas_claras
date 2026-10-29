import type { Router } from 'express'
import type { ModuleDeps } from '../../common/modules.ts'
import type { PantryApi } from '../pantry/index.ts'
import { ticketRoutes } from './adapters/http/routes.ts'
import { SqliteTicketRepository } from './adapters/sqlite/SqliteTicketRepository.ts'
import type { TicketReader } from './adapters/tesseract/TesseractTicketReader.ts'

/**
 * Módulo tickets: leer los tickets de la compra (OCR local), guardarlos, lo
 * aprendido en cada tienda, el historial y la actividad para el ritmo de compra.
 * API pública del módulo (ver AGENTS.md).
 */

export { createTesseractReader, type TicketReader } from './adapters/tesseract/TesseractTicketReader.ts'

export interface TicketsModule {
  /** /api/despensa/tickets…, /tickets/leer y /actividad (públicas, como la despensa). */
  router: Router
  /** Vacía los tickets y lo aprendido (solo para POST /api/test/reset). */
  reset(): void
}

export function createTicketsModule({
  db,
  clock,
  ids,
  unitOfWork,
  pantry,
  reader,
}: ModuleDeps & { pantry: PantryApi; reader: TicketReader }): TicketsModule {
  const repository = new SqliteTicketRepository(db, pantry, { now: () => clock.nowISO(), newId: () => ids.newId() })
  return { router: ticketRoutes(repository, pantry, reader), reset: () => unitOfWork.run(() => repository.reset()) }
}
