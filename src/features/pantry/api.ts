import type { TicketDraft } from '#shared/tickets/ticketMatch.ts'
import type { ISODate } from '#shared/common/types.ts'
import type {
  PantryActivity,
  PantryEvent,
  PantryEventKind,
  PantryItem,
  PantryItemInput,
  PantryPerson,
  PantryPurchaseChange,
  PantrySettings,
} from '#shared/pantry/types.ts'
import type { PantryTicket, PantryTicketSummary, TicketSaveInput, TicketReadInput } from '#shared/tickets/types.ts'
import { apiRequest, segment } from '../../api/client.ts'

/**
 * Cliente de la API de la despensa (/api/despensa). Es pública: funciona igual
 * para invitados y para quien ha escrito el código.
 */
export const pantryApi = {
  listPeople: () => apiRequest<PantryPerson[]>('GET', '/despensa/personas'),
  createPerson: (name: string) => apiRequest<PantryPerson>('POST', '/despensa/personas', { name }),
  renamePerson: (id: string, name: string) => apiRequest<PantryPerson>('PUT', `/despensa/personas/${segment(id)}`, { name }),
  deletePerson: (id: string) => apiRequest<null>('DELETE', `/despensa/personas/${segment(id)}`),

  listItems: () => apiRequest<PantryItem[]>('GET', '/despensa/productos'),
  createItem: (input: PantryItemInput) => apiRequest<PantryItem>('POST', '/despensa/productos', input),
  updateItem: (id: string, input: PantryItemInput) => apiRequest<PantryItem>('PUT', `/despensa/productos/${segment(id)}`, input),
  adjustItem: (id: string, delta: number) => apiRequest<PantryItem>('POST', `/despensa/productos/${segment(id)}/ajustar`, { delta }),
  deleteItem: (id: string) => apiRequest<null>('DELETE', `/despensa/productos/${segment(id)}`),

  addEvent: (itemId: string, kind: PantryEventKind, date: ISODate) =>
    apiRequest<PantryEvent>('POST', `/despensa/productos/${segment(itemId)}/revision`, { kind, date }),
  deleteEvent: (id: string) => apiRequest<null>('DELETE', `/despensa/revisiones/${segment(id)}`),
  activity: (today: ISODate) => apiRequest<PantryActivity>('GET', `/despensa/actividad?hoy=${segment(today)}`),

  getSettings: () => apiRequest<PantrySettings>('GET', '/despensa/presupuesto'),
  setBudget: (monthlyBudgetCents: number | null) => apiRequest<PantrySettings>('PUT', '/despensa/presupuesto', { monthlyBudgetCents }),
  setReviewDate: (date: ISODate) => apiRequest<PantrySettings>('PUT', '/despensa/repaso', { date }),

  markPurchased: (ids: readonly string[], date: ISODate) =>
    apiRequest<{ changes: PantryPurchaseChange[]; items: PantryItem[] }>('POST', '/despensa/comprado', { ids, date }),
  undoPurchase: (changes: readonly PantryPurchaseChange[]) => apiRequest<PantryItem[]>('POST', '/despensa/comprado/deshacer', { changes }),

  readTicket: (input: TicketReadInput, today: ISODate) =>
    apiRequest<TicketDraft>('POST', '/despensa/tickets/leer', { ...input, hoy: today }),
  saveTicket: (input: TicketSaveInput) => apiRequest<{ ticket: PantryTicket; items: PantryItem[] }>('POST', '/despensa/tickets', input),
  listTickets: () => apiRequest<PantryTicketSummary[]>('GET', '/despensa/tickets'),
  getTicket: (id: string) => apiRequest<PantryTicket>('GET', `/despensa/tickets/${segment(id)}`),
  setTicketLine: (ticketId: string, lineId: string, itemId: string | null) =>
    apiRequest<PantryTicket>('PUT', `/despensa/tickets/${segment(ticketId)}/lineas/${segment(lineId)}`, { itemId }),
  deleteTicket: (id: string) => apiRequest<null>('DELETE', `/despensa/tickets/${segment(id)}`),
}
