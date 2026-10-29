import type { PantryTicket } from '#shared/tickets/types.ts'
import { AppError } from '../../../common/errors.ts'
import type { Clock, UnitOfWork } from '../../../common/ports.ts'
import { aliasStoreOf } from '../domain/ticketIdentity.ts'
import type { PantryGateway, TicketRepository } from './ports.ts'
import type { TicketQueries } from './queries.ts'

/**
 * Cambiar el producto de una línea de un ticket guardado (null = no seguirla).
 * Cambian a la vez todas las líneas iguales del ticket, y queda aprendido para
 * la próxima vez en esa tienda.
 */
export class SetLineItem {
  private readonly repository: TicketRepository
  private readonly pantry: PantryGateway
  private readonly queries: TicketQueries
  private readonly clock: Clock
  private readonly unitOfWork: UnitOfWork

  constructor(
    repository: TicketRepository,
    pantry: PantryGateway,
    queries: TicketQueries,
    clock: Clock,
    unitOfWork: UnitOfWork,
  ) {
    this.repository = repository
    this.pantry = pantry
    this.queries = queries
    this.clock = clock
    this.unitOfWork = unitOfWork
  }

  execute(ticketId: string, lineId: string, itemId: string | null): PantryTicket {
    return this.unitOfWork.run(
      () => {
        const ticket = this.repository.getSummary(ticketId)
        if (!ticket) throw new AppError('NOT_FOUND', 'Ese ticket ya no existe.')
        const line = this.repository.getLine(ticketId, lineId)
        if (!line) throw new AppError('NOT_FOUND', 'Esa línea del ticket ya no existe.')
        if (itemId !== null && !this.pantry.getItem(itemId)) {
          throw new AppError('VALIDATION', 'Ese producto ya no existe. Elige otro.')
        }
        // Todas las líneas iguales del ticket cambian a la vez.
        for (const other of this.repository.linesOf(ticketId)) {
          if (other.nameKey === line.nameKey) this.repository.setLineItem(other.id, itemId)
        }
        this.repository.upsertAlias(aliasStoreOf(ticket.store, ticket.storeName), line.nameKey, itemId, this.clock.nowISO())
        return this.queries.getTicket(ticketId)
      },
      { immediate: true },
    )
  }
}
