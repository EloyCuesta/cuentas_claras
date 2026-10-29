import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sortItems, sortPeople } from '../domain/pantry.ts'
import type { PantryItem, PantryItemInput, PantryPerson, PantryPurchaseChange, PantrySettings } from '../domain/types.ts'
import { pantryApi } from '../services/pantryApi.ts'
import { describeStorageError } from './storageErrors.ts'

export type PantryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; people: PantryPerson[]; items: PantryItem[]; settings: PantrySettings }

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
  /** Devuelve lo necesario para deshacer. */
  markPurchased(ids: readonly string[]): Promise<PantryPurchaseChange[]>
  undoPurchase(changes: readonly PantryPurchaseChange[]): Promise<void>
}

/**
 * Estado de la despensa, independiente de FinanceProvider: lo usan igual el
 * invitado y el administrador. Cada escritura refleja lo que confirma el
 * servidor. Al volver a la pestaña se recarga, por si alguien la cambió desde
 * otro móvil.
 */
export function usePantry(): { state: PantryState; actions: PantryActions } {
  const [state, setState] = useState<PantryState>({ status: 'loading' })
  // Si una escritura termina mientras se recargaba, la recarga (más antigua) no la pisa.
  const writes = useRef(0)

  const reload = useCallback(() => {
    const startedAt = writes.current
    return Promise.all([pantryApi.listPeople(), pantryApi.listItems(), pantryApi.getSettings()]).then(
      ([people, items, settings]) => {
        if (startedAt === writes.current) setState({ status: 'ready', people, items, settings })
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
    const update = (change: (ready: Extract<PantryState, { status: 'ready' }>) => Partial<Extract<PantryState, { status: 'ready' }>>) => {
      writes.current++
      setState((current) => (current.status === 'ready' ? { ...current, ...change(current) } : current))
    }
    const putItem = (item: PantryItem) =>
      update(({ items }) => ({ items: sortItems([...items.filter((i) => i.id !== item.id), item]) }))

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
        update(({ items }) => ({ items: items.filter((i) => i.id !== id) }))
      },
      async adjustItem(id, delta) {
        putItem(await pantryApi.adjustItem(id, delta))
      },
      async setBudget(cents) {
        const settings = await pantryApi.setBudget(cents)
        update(() => ({ settings }))
      },
      async markPurchased(ids) {
        const { changes, items } = await pantryApi.markPurchased(ids)
        update(() => ({ items }))
        return changes
      },
      async undoPurchase(changes) {
        const items = await pantryApi.undoPurchase(changes)
        update(() => ({ items }))
      },
    }
  }, [reload])

  return { state, actions }
}
