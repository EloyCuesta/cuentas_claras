import { addDays } from '#shared/common/dates.ts'
import type { ISODate } from '#shared/common/types.ts'
import type { PantryActivity } from '#shared/pantry/types.ts'
import type { PantryTicket, PantryTicketSummary } from '#shared/tickets/types.ts'
import { AppError } from '../../../common/errors.ts'
import type { Clock } from '../../../common/ports.ts'
import { purchasesFromLines } from '../domain/purchaseHistory.ts'
import type { PantryGateway, TicketRepository } from './ports.ts'

/** Días de historial que se mandan para el ritmo de compra. */
const ACTIVITY_DAYS = 400
const RECENT_TICKETS = 100

/** Lecturas de los tickets. */
export class TicketQueries {
  private readonly repository: TicketRepository
  private readonly pantry: PantryGateway
  private readonly clock: Clock

  constructor(repository: TicketRepository, pantry: PantryGateway, clock: Clock) {
    this.repository = repository
    this.pantry = pantry
    this.clock = clock
  }

  /** Los últimos tickets (resumen), los más recientes primero. */
  listTickets(): PantryTicketSummary[] {
    return this.repository.listSummaries(RECENT_TICKETS)
  }

  /** Un ticket con sus líneas (404 si ya no existe). */
  getTicket(id: string): PantryTicket {
    const ticket = this.repository.getTicket(id)
    if (!ticket) throw new AppError('NOT_FOUND', 'Ese ticket ya no existe.')
    return ticket
  }

  /**
   * Historial para el ritmo de compra: las compras de los tickets (una por
   * producto y ticket) y las revisiones de la despensa. `today` es la fecha de
   * hoy del navegador; sin ella, la del servidor.
   */
  activity(today: ISODate | null): PantryActivity {
    const since = addDays(today ?? this.clock.today(), -ACTIVITY_DAYS)
    return {
      purchases: purchasesFromLines(this.repository.purchaseLinesSince(since)),
      events: this.pantry.eventsSince(since),
    }
  }
}
