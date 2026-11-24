import { createContext, useContext } from 'react'
import type { ISODate } from '#shared/common/types.ts'
import type {
  PantryActivity,
  PantryEvent,
  PantryEventKind,
  PantryItem,
  PantryItemInput,
  PantryItemUpdate,
  PantryPerson,
  PantryPurchaseChange,
  PantrySettings,
} from '#shared/pantry/types.ts'
import type { PantryTicketSummary } from '#shared/tickets/types.ts'
import type { TicketActions } from '../tickets/index.ts'

export interface PantryData {
  people: PantryPerson[]
  /** Con los + y − que aún esperan al servidor ya sumados (se ven al momento). */
  items: PantryItem[]
  settings: PantrySettings
  /** Compras y revisiones (para el ritmo de compra), con las revisiones que aún esperan al servidor. */
  activity: PantryActivity
  tickets: PantryTicketSummary[]
  /** Fecha de hoy con la que se calculan los avisos. */
  today: ISODate
}

export type PantryState = { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & PantryData)

/** Las acciones de la despensa y las de los tickets (TicketActions), que viven aquí porque guardar un ticket cambia la despensa. */
export interface PantryActions extends TicketActions {
  /** La primera vez, carga la despensa; después, la vuelve a leer en segundo plano sin quitar lo que se ve. */
  reload(): Promise<void>
  createPerson(name: string): Promise<void>
  renamePerson(id: string, name: string): Promise<void>
  deletePerson(id: string): Promise<void>
  createItem(input: PantryItemInput): Promise<void>
  /** Con la versión con que se abrió el formulario: 409 si alguien lo cambió mientras tanto (no se reintenta solo). */
  updateItem(id: string, update: PantryItemUpdate): Promise<void>
  /** Vuelve a leer los productos y devuelve ese como está ahora (null si ya no existe). */
  reloadItem(id: string): Promise<PantryItem | null>
  deleteItem(id: string): Promise<void>
  /**
   * Botones + y −: el cambio se ve al momento y va al servidor en la cola del producto (de uno en uno). El servidor
   * suma o resta sobre su valor actual y devuelve el resultado; si falla, se deshace en pantalla y la promesa falla.
   */
  adjustItem(id: string, delta: number): Promise<void>
  setBudget(cents: number | null): Promise<void>
  /** Apunta que hoy se ha hecho el repaso de la semana. */
  finishReview(): Promise<void>
  /** Devuelve lo necesario para deshacer. */
  markPurchased(ids: readonly string[]): Promise<PantryPurchaseChange[]>
  undoPurchase(changes: readonly PantryPurchaseChange[]): Promise<void>
  /**
   * «Queda», «Queda poco», «Se acabó» o «Lo he comprado», con la fecha de hoy: se ve al momento y va al servidor en la
   * cola del producto. Devuelve la revisión guardada (para deshacerla); si falla, se quita de la pantalla.
   */
  addEvent(itemId: string, kind: PantryEventKind): Promise<PantryEvent>
  deleteEvent(id: string): Promise<void>
}

export interface PantryContextValue {
  state: PantryState
  actions: PantryActions
}

export const PantryContext = createContext<PantryContextValue | null>(null)

/** La despensa y sus acciones. Solo dentro de <PantryProvider> (App y GuestApp lo montan). */
export function usePantry(): PantryContextValue {
  const value = useContext(PantryContext)
  if (!value) throw new Error('usePantry debe usarse dentro de <PantryProvider>.')
  return value
}
