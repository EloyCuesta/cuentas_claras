import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { todayISO } from '../domain/dates.ts'
import { pantryApi } from '../services/pantryApi.ts'
import { PantryContext, type PantryActions, type PantryData, type PantryState } from './pantryContext.ts'
import { describeStorageError } from './storageErrors.ts'

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
 * invitado y el administrador. Funciona como FinanceProvider: cada escritura
 * va al servidor y después se vuelve a leer la despensa entera, así lo que se
 * ve es siempre lo que hay guardado. Al volver a la pestaña también se recarga
 * (por si alguien la cambió desde otro móvil, o ha cambiado el día).
 */
export function PantryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PantryState>({ status: 'loading' })
  // Solo se aplica la lectura más reciente: una recarga lenta no pisa a otra más nueva.
  const latest = useRef(0)

  const reload = useCallback(() => {
    const token = ++latest.current
    return loadAll().then(
      (data) => {
        if (token === latest.current) setState({ status: 'ready', ...data })
      },
      (error: unknown) => {
        // Con datos ya en pantalla, un fallo al recargar no los borra.
        if (token !== latest.current) return
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
    /** Guarda en el servidor y recarga la despensa. Devuelve lo que respondió el servidor. */
    const write = async <T,>(work: () => Promise<T>): Promise<T> => {
      const result = await work()
      await reload()
      return result
    }
    const done = () => undefined

    return {
      reload,
      createPerson: (name) => write(() => pantryApi.createPerson(name)).then(done),
      renamePerson: (id, name) => write(() => pantryApi.renamePerson(id, name)).then(done),
      deletePerson: (id) => write(() => pantryApi.deletePerson(id)).then(done),
      saveItem: (id, input) => write(() => (id === null ? pantryApi.createItem(input) : pantryApi.updateItem(id, input))).then(done),
      deleteItem: (id) => write(() => pantryApi.deleteItem(id)).then(done),
      adjustItem: (id, delta) => write(() => pantryApi.adjustItem(id, delta)).then(done),
      setBudget: (cents) => write(() => pantryApi.setBudget(cents)).then(done),
      finishReview: () => write(() => pantryApi.setReviewDate(todayISO())).then(done),
      markPurchased: (ids) => write(() => pantryApi.markPurchased(ids, todayISO())).then(({ changes }) => changes),
      undoPurchase: (changes) => write(() => pantryApi.undoPurchase(changes)).then(done),
      addEvent: (itemId, kind) => write(() => pantryApi.addEvent(itemId, kind, todayISO())),
      deleteEvent: (id) => write(() => pantryApi.deleteEvent(id)).then(done),
      readTicket: (input) => pantryApi.readTicket(input, todayISO()),
      saveTicket: (input) => write(() => pantryApi.saveTicket(input)).then(({ ticket }) => ticket),
      getTicket: (id) => pantryApi.getTicket(id),
      setTicketLine: (ticketId, lineId, itemId) => write(() => pantryApi.setTicketLine(ticketId, lineId, itemId)),
      deleteTicket: (id) => write(() => pantryApi.deleteTicket(id)).then(done),
    }
  }, [reload])

  const value = useMemo(() => ({ state, actions }), [state, actions])
  return <PantryContext.Provider value={value}>{children}</PantryContext.Provider>
}
