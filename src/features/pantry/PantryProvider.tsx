import { useMemo, useState, type ReactNode } from 'react'
import { todayISO } from '#shared/common/dates.ts'
import { sortItems, sortPeople } from '#shared/pantry/pantry.ts'
import type { PantryEvent, PantryItem } from '#shared/pantry/types.ts'
import { pantryApi } from './api.ts'
import { describeStorageError } from '../../api/storageErrors.ts'
import { PantryContext, type PantryActions, type PantryData, type PantryState } from './pantryContext.ts'

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

type Ready = Extract<PantryState, { status: 'ready' }>

/** Las cantidades van en pasos de 0,5 o de 1 (y de 50 g o 100 ml): se redondean a milésimas para que no se acumule error. */
const round = (n: number) => Math.round(n * 1000) / 1000

/**
 * El estado de la despensa, compartido (UX-02): lo montan App (con el código) y GuestApp (invitado), sin
 * FinanceProvider. Se carga la primera vez que se abre la Despensa; al volver a ella, lo de antes se ve al momento y
 * se relee en segundo plano.
 *
 * + y −, «Queda», «Queda poco», «Se acabó» y «Lo he comprado» se ven al momento:
 * - cada producto tiene una cola: sus cambios van al servidor de uno en uno, en orden;
 * - + y − mandan el paso (el servidor suma sobre su valor, también desde dos móviles a la vez) y lo que devuelve es lo
 *   que queda; mientras tanto se enseña lo último del servidor más lo que falta por confirmar (`pending`);
 * - una revisión se enseña con un id provisional hasta que llega la guardada;
 * - si algo falla, se quita de la pantalla y la acción falla (quien la pidió avisa).
 * Una relectura que empezó antes de una escritura no la pisa (un contador de escrituras).
 */
export function PantryProvider({ children }: { children: ReactNode }) {
  const [server, setServer] = useState<PantryState>({ status: 'loading' })
  /** Por producto, lo que suman los + y − que aún esperan al servidor. */
  const [pending, setPending] = useState<Record<string, number>>({})
  /** Revisiones que aún esperan al servidor (con id provisional). */
  const [localEvents, setLocalEvents] = useState<PantryEvent[]>([])

  const actions = useMemo<PantryActions>(() => {
    let writes = 0
    let nextLocal = 0
    const queues = new Map<string, Promise<unknown>>()
    /** Pone `work` en la cola del producto: empieza cuando terminan los anteriores, falle o no. */
    const enqueue = <T,>(id: string, work: () => Promise<T>): Promise<T> => {
      const run = (queues.get(id) ?? Promise.resolve()).then(work, work)
      queues.set(id, run.catch(() => undefined))
      return run
    }
    const update = (change: (ready: Ready) => Partial<PantryData>) => {
      writes++
      setServer((current) => (current.status === 'ready' ? { ...current, ...change(current) } : current))
    }
    const putItem = (item: PantryItem) => update(({ items }) => ({ items: sortItems([...items.filter((i) => i.id !== item.id), item]) }))
    const addPending = (id: string, delta: number) => setPending((current) => {
      const value = round((current[id] ?? 0) + delta)
      const next = { ...current }
      if (value === 0) delete next[id]
      else next[id] = value
      return next
    })
    const reload = () => {
      const startedAt = writes
      return loadAll().then(
        (data) => {
          if (startedAt === writes) setServer({ status: 'ready', ...data })
        },
        (error: unknown) => {
          // Con datos ya en pantalla, un fallo al recargar no los borra.
          setServer((current) => (current.status === 'ready' ? current : { status: 'error', message: describeStorageError(error) }))
        },
      )
    }
    /** Tras cambiar una línea o borrar un ticket cambian productos, compras y tickets: se vuelve a leer todo. */
    const refreshAll = async () => {
      writes++
      const data = await loadAll()
      writes++
      setServer({ status: 'ready', ...data })
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
      async createItem(input) {
        putItem(await pantryApi.createItem(input))
      },
      async updateItem(id, change) {
        putItem(await pantryApi.updateItem(id, change))
      },
      async reloadItem(id) {
        const items = await pantryApi.listItems()
        update(() => ({ items }))
        return items.find((item) => item.id === id) ?? null
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
      adjustItem(id, delta) {
        addPending(id, delta)
        return enqueue(id, async () => {
          try {
            putItem(await pantryApi.adjustItem(id, delta))
          } finally {
            // En el mismo paso que el valor del servidor: la pantalla no salta.
            addPending(id, -delta)
          }
        })
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
      addEvent(itemId, kind) {
        const today = todayISO()
        const shown: PantryEvent = { id: `local-${++nextLocal}`, itemId, kind, date: today, createdAt: new Date().toISOString() }
        setLocalEvents((current) => [...current, shown])
        return enqueue(itemId, async () => {
          try {
            const event = await pantryApi.addEvent(itemId, kind, today)
            update(({ activity }) => ({ activity: { ...activity, events: [...activity.events, event] } }))
            return event
          } finally {
            setLocalEvents((current) => current.filter((e) => e.id !== shown.id))
          }
        })
      },
      async deleteEvent(id) {
        await pantryApi.deleteEvent(id)
        update(({ activity }) => ({ activity: { ...activity, events: activity.events.filter((e) => e.id !== id) } }))
      },
      readTicket(input) {
        return pantryApi.readTicket(input, todayISO())
      },
      async saveTicket(input) {
        // El servidor devuelve ya los productos como quedan: entran al momento y la ventana se cierra tras una sola
        // petición. Los tickets y la actividad (el ritmo) se releen en segundo plano.
        const { ticket, items } = await pantryApi.saveTicket(input)
        update(() => ({ items }))
        void Promise.all([pantryApi.listTickets(), pantryApi.activity(todayISO())]).then(
          ([tickets, activity]) => update(() => ({ tickets, activity })),
          () => undefined,
        )
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
  }, [])

  // Lo que se enseña: lo del servidor más lo que aún espera respuesta.
  const state = useMemo<PantryState>(() => {
    if (server.status !== 'ready') return server
    const items = Object.keys(pending).length === 0 ? server.items
      : server.items.map((item) => (pending[item.id] ? { ...item, quantity: Math.max(0, round(item.quantity + pending[item.id])) } : item))
    const activity = localEvents.length === 0 ? server.activity : { ...server.activity, events: [...server.activity.events, ...localEvents] }
    return { ...server, items, activity }
  }, [server, pending, localEvents])

  const value = useMemo(() => ({ state, actions }), [state, actions])
  return <PantryContext.Provider value={value}>{children}</PantryContext.Provider>
}
