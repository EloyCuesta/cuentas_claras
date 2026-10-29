import type { Router } from 'express'
import type { ISODate } from '#shared/common/types.ts'
import type { PantryEvent, PantryItem, PantryItemInput } from '#shared/pantry/types.ts'
import type { ModuleDeps } from '../../common/modules.ts'
import { pantryRoutes } from './adapters/http/routes.ts'
import { SqlitePantryRepository } from './adapters/sqlite/SqlitePantryRepository.ts'
import { AddEvent } from './application/AddEvent.ts'
import { AdjustItem } from './application/AdjustItem.ts'
import { ApplyTicketPurchase, type TicketPurchase } from './application/ApplyTicketPurchase.ts'
import { CreateItem } from './application/CreateItem.ts'
import { CreatePerson } from './application/CreatePerson.ts'
import { DeleteEvent } from './application/DeleteEvent.ts'
import { DeleteItem } from './application/DeleteItem.ts'
import { DeletePerson } from './application/DeletePerson.ts'
import { MarkPurchased } from './application/MarkPurchased.ts'
import { PantryQueries } from './application/queries.ts'
import { RenamePerson } from './application/RenamePerson.ts'
import { SetBudget } from './application/SetBudget.ts'
import { SetReviewDate } from './application/SetReviewDate.ts'
import { UndoPurchase } from './application/UndoPurchase.ts'
import { UpdateItem } from './application/UpdateItem.ts'

/**
 * Módulo pantry: la Despensa (personas, productos, revisiones, presupuesto,
 * repaso de la semana, comprar y deshacer). API pública del módulo (ver AGENTS.md).
 */

export type { TicketPurchase } from './application/ApplyTicketPurchase.ts'

/** Lo que otros módulos pueden usar de la despensa (hoy, tickets: su PantryGateway). */
export interface PantryApi {
  getItem(id: string): PantryItem | null
  createItem(input: PantryItemInput): PantryItem
  applyTicketPurchase(id: string, purchase: TicketPurchase): void
  listItems(): PantryItem[]
  eventsSince(date: ISODate): PantryEvent[]
}

export interface PantryModule {
  /** /api/despensa/personas, productos, revisiones, presupuesto, repaso y comprado (públicas). */
  router: Router
  api: PantryApi
  /** Vacía la despensa (solo para POST /api/test/reset). */
  reset(): void
}

export function createPantryModule({ db, clock, ids, unitOfWork }: ModuleDeps): PantryModule {
  const repository = new SqlitePantryRepository(db)
  const queries = new PantryQueries(repository)
  const createItem = new CreateItem(repository, clock, ids, unitOfWork)
  const addEvent = new AddEvent(repository, clock, ids, unitOfWork)
  const applyTicketPurchase = new ApplyTicketPurchase(repository, clock, unitOfWork)

  const router = pantryRoutes({
    queries,
    createPerson: new CreatePerson(repository, clock, ids, unitOfWork),
    renamePerson: new RenamePerson(repository, unitOfWork),
    deletePerson: new DeletePerson(repository, unitOfWork),
    createItem,
    updateItem: new UpdateItem(repository, clock, unitOfWork),
    adjustItem: new AdjustItem(repository, clock, unitOfWork),
    deleteItem: new DeleteItem(repository, unitOfWork),
    addEvent,
    deleteEvent: new DeleteEvent(repository, unitOfWork),
    setBudget: new SetBudget(repository, unitOfWork),
    setReviewDate: new SetReviewDate(repository, unitOfWork),
    markPurchased: new MarkPurchased(repository, queries, addEvent, clock, unitOfWork),
    undoPurchase: new UndoPurchase(repository, queries, clock, unitOfWork),
  })

  return {
    router,
    api: {
      getItem: (id) => queries.getItem(id),
      createItem: (input) => createItem.execute(input),
      applyTicketPurchase: (id, purchase) => applyTicketPurchase.execute(id, purchase),
      listItems: () => queries.listItems(),
      eventsSince: (date) => queries.eventsSince(date),
    },
    reset: () => unitOfWork.run(() => repository.reset()),
  }
}
