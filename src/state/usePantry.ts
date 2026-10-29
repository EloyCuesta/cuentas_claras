import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { todayISO } from '../domain/dates.ts'
import { sortItems, sortPeople } from '../domain/pantry.ts'
import type { TicketDraft } from '../domain/ticketMatch.ts'
import type {
  ISODate,
  PantryActivity,
  PantryEvent,
  PantryEventKind,
  PantryItem,
  PantryItemInput,
  PantryPerson,
  PantryPurchaseChange,
  PantrySettings,
  PantryTicket,
  PantryTicketSummary,
  TicketSaveInput,
  TicketReadInput,
} from '../domain/types.ts'
import { pantryApi } from '../services/pantryApi.ts'
import { describeStorageError } from './storageErrors.ts'

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

async function loadAll(): Promise<PantryData> {
  const today = todayISO()
  const [people, items, settings, activity, tickets] = await Promise.all([
    pantryApi.listPeople(),
    pantryApi.listItems(),
    pantryApi.getSettings(),
    pantryApi.activity(today),
    pantryApi.listTickets(),
  ])
  return { people, items, settings, activity, tickets, today }
}

/**
 * Estado de la despensa, independiente de FinanceProvider: lo usan igual el
 * invitado y el administrador. Cada escritura refleja lo que confirma el
 * servidor. Al volver a la pestaña se recarga (por si alguien la cambió desde
 * otro móvil, o ha cambiado el día).
 */
export function usePantry(): { state: PantryState; actions: PantryActions } {
  const [state, setState] = useState<PantryState>({ status: 'loading' })
  // Si una escritura termina mientras se recargaba, la recarga (más antigua) no la pisa.
  const writes = useRef(0)

  const reload = useCallback(() => {
    const startedAt = writes.current
    return loadAll().then(
      (data) => {
        if (startedAt === writes.current) setState({ status: 'ready', ...data })
      },
      (error: unknown) => {
        // Con datos ya en pantalla, un fallo al recargar no los borra.
        setState((current) => (current.status === 'ready' ? current : { status: 'error', message: describeStorageError(error) }))
      },
    )
  }, [])

  useEffect(() => {
    void reload()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reload])

  const actions = useMemo<PantryActions>(() => {
    type Ready = Extract<PantryState, { status: 'ready' }>
    const update = (change: (ready: Ready) => Partial<PantryData>) => {
      writes.current++
      setState((current) => (current.status === 'ready' ? { ...current, ...change(current) } : current))
    }
    const putItem = (item: PantryItem) => update(({ items }) => ({ items: sortItems([...items.filter((i) => i.id !== item.id), item]) }))
    /** Tras guardar o borrar un ticket cambian productos, compras y tickets: se vuelve a leer todo. */
    const refreshAll = async () => {
      writes.current++
      const data = await loadAll()
      writes.current++
      setState({ status: 'ready', ...data })
    }
    const refreshActivity = async () => {
      const activity = await pantryApi.activity(todayISO())
      update(() => ({ activity }))
    }

    return {
      reload,
      async createPerson(name) {
        const person = await pantryApi.createPerson(name)
        update(({ people }) => ({ people: sortPeople([...people, person]) }))
      },
      async renamePerson(id, name) {
        const person = await pantryApi.renamePerson(id, name)
        update(({ people }) => ({ people: sortPeople(people.map((p) => (p.id === id ? person : p))) }))
      },
      async deletePerson(id) {
        await pantryApi.deletePerson(id)
        update(({ people }) => ({ people: people.filter((p) => p.id !== id) }))
      },
      async saveItem(id, input) {
        putItem(id === null ? await pantryApi.createItem(input) : await pantryApi.updateItem(id, input))
      },
      async deleteItem(id) {
        await pantryApi.deleteItem(id)
        update(({ items, activity }) => ({
          items: items.filter((i) => i.id !== id),
          activity: {
            purchases: activity.purchases.filter((p) => p.itemId !== id),
            events: activity.events.filter((e) => e.itemId !== id),
          },
        }))
      },
      async adjustItem(id, delta) {
        putItem(await pantryApi.adjustItem(id, delta))
      },
      async setBudget(cents) {
        const settings = await pantryApi.setBudget(cents)
        update(() => ({ settings }))
      },
      async finishReview() {
        const settings = await pantryApi.setReviewDate(todayISO())
        update(() => ({ settings }))
      },
      async markPurchased(ids) {
        const { changes, items } = await pantryApi.markPurchased(ids, todayISO())
        update(() => ({ items }))
        if (changes.some((change) => 'eventId' in change)) await refreshActivity()
        return changes
      },
      async undoPurchase(changes) {
        const items = await pantryApi.undoPurchase(changes)
        update(() => ({ items }))
        if (changes.some((change) => 'eventId' in change)) await refreshActivity()
      },
      async addEvent(itemId, kind) {
        const event = await pantryApi.addEvent(itemId, kind, todayISO())
        update(({ activity }) => ({ activity: { ...activity, events: [...activity.events, event] } }))
        return event
      },
      async deleteEvent(id) {
        await pantryApi.deleteEvent(id)
        update(({ activity }) => ({ activity: { ...activity, events: activity.events.filter((e) => e.id !== id) } }))
      },
      readTicket(input) {
        return pantryApi.readTicket(input, todayISO())
      },
      async saveTicket(input) {
        const { ticket } = await pantryApi.saveTicket(input)
        await refreshAll()
        return ticket
      },
      getTicket(id) {
        return pantryApi.getTicket(id)
      },
      async setTicketLine(ticketId, lineId, itemId) {
        const ticket = await pantryApi.setTicketLine(ticketId, lineId, itemId)
        await refreshAll()
        return ticket
      },
      async deleteTicket(id) {
        await pantryApi.deleteTicket(id)
        await refreshAll()
      },
    }
  }, [reload])

  return { state, actions }
}
