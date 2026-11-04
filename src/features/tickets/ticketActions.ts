import type { TicketDraft } from '#shared/tickets/ticketMatch.ts'
import type { PantryTicket, TicketReadInput, TicketSaveInput } from '#shared/tickets/types.ts'

/**
 * Lo que necesitan los diálogos de tickets. No lo implementa esta feature,
 * sino usePantry (feature pantry): guardar, cambiar o borrar un ticket cambia a
 * la vez productos, compras y tickets, y usePantry vuelve a leer la despensa
 * entera. Así la dependencia va en un solo sentido: pantry → tickets.
 */
export interface TicketActions {
  /** Lee un ticket (imágenes ya preparadas o texto). No guarda nada. */
  readTicket(input: TicketReadInput): Promise<TicketDraft>
  saveTicket(input: TicketSaveInput): Promise<PantryTicket>
  getTicket(id: string): Promise<PantryTicket>
  setTicketLine(ticketId: string, lineId: string, itemId: string | null): Promise<PantryTicket>
  deleteTicket(id: string): Promise<void>
}
