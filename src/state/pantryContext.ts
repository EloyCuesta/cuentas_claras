import { createContext, useContext } from 'react'
import type { TicketDraft } from '../domain/ticketMatch.ts'
import type {
  ISODate,
  PantryActivity,
  PantryEvent,
  PantryEventKind,
  PantryItemInput,
  PantryItem,
  PantryPerson,
  PantryPurchaseChange,
  PantrySettings,
  PantryTicket,
  PantryTicketSummary,
  TicketReadInput,
  TicketSaveInput,
} from '../domain/types.ts'

export interface PantryData {
  people: PantryPerson[]
  items: PantryItem[]
  settings: PantrySettings
  /** Compras y revisiones (para el ritmo de compra). */
  activity: PantryActivity
  tickets: PantryTicketSummary[]
  /** Fecha de hoy con la que se calculan los avisos. */
  today: ISODate
}

export type PantryState = { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & PantryData)

/** Acciones de la despensa. Las que escriben guardan en el servidor y recargan la despensa. */
export interface PantryActions {
  reload(): Promise<void>
  createPerson(name: string): Promise<void>
  renamePerson(id: string, name: string): Promise<void>
  deletePerson(id: string): Promise<void>
  /** id null = producto nuevo. */
  saveItem(id: string | null, input: PantryItemInput): Promise<void>
  deleteItem(id: string): Promise<void>
  /** Botones + y −: el servidor suma o resta sobre su valor actual y devuelve el resultado. */
  adjustItem(id: string, delta: number): Promise<void>
  setBudget(cents: number | null): Promise<void>
  /** Apunta que hoy se ha hecho el repaso de la semana. */
  finishReview(): Promise<void>
  /** Devuelve lo necesario para deshacer. */
  markPurchased(ids: readonly string[]): Promise<PantryPurchaseChange[]>
  undoPurchase(changes: readonly PantryPurchaseChange[]): Promise<void>
  /** «Queda», «Queda poco», «Se acabó» o «Lo he comprado», con la fecha de hoy. Devuelve la revisión (para deshacerla). */
  addEvent(itemId: string, kind: PantryEventKind): Promise<PantryEvent>
  deleteEvent(id: string): Promise<void>
  /** Lee un ticket (imágenes ya preparadas o texto). No guarda nada. */
  readTicket(input: TicketReadInput): Promise<TicketDraft>
  saveTicket(input: TicketSaveInput): Promise<PantryTicket>
  getTicket(id: string): Promise<PantryTicket>
  setTicketLine(ticketId: string, lineId: string, itemId: string | null): Promise<PantryTicket>
  deleteTicket(id: string): Promise<void>
}

export interface PantryContextValue {
  state: PantryState
  actions: PantryActions
}

export const PantryContext = createContext<PantryContextValue | null>(null)

/** Estado y acciones de la despensa. Solo se puede usar dentro de <PantryProvider>. */
export function usePantry(): PantryContextValue {
  const value = useContext(PantryContext)
  if (!value) throw new Error('usePantry debe usarse dentro de <PantryProvider>.')
  return value
}

/** Solo las acciones (para las ventanas que no necesitan el estado). */
export function usePantryActions(): PantryActions {
  return usePantry().actions
}
