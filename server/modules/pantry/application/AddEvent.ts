import type { ISODate } from '#shared/common/types.ts'
import type { PantryEvent, PantryEventKind } from '#shared/pantry/types.ts'
import type { Clock, IdGenerator, UnitOfWork } from '../../../common/ports.ts'
import type { PantryRepository } from './ports.ts'
import { requireItem } from './require.ts'

/**
 * Apuntar una revisión de un producto: «Queda», «Queda poco», «Se acabó» o
 * «Lo he comprado», con la fecha de hoy que manda el navegador. Devuelve la
 * revisión, para poder deshacerla.
 */
export class AddEvent {
  private readonly repository: PantryRepository
  private readonly clock: Clock
  private readonly ids: IdGenerator
  private readonly unitOfWork: UnitOfWork

  constructor(repository: PantryRepository, clock: Clock, ids: IdGenerator, unitOfWork: UnitOfWork) {
    this.repository = repository
    this.clock = clock
    this.ids = ids
    this.unitOfWork = unitOfWork
  }

  execute(itemId: string, kind: PantryEventKind, date: ISODate): Promise<PantryEvent> {
    return this.unitOfWork.run(async () => {
      // Si otro lo borra a la vez, aquí espera y después da 404, como cuando todo iba en serie.
      await this.repository.lockItems([itemId])
      await requireItem(this.repository, itemId)
      const event = { id: this.ids.newId(), itemId, kind, date, createdAt: this.clock.nowISO() }
      await this.repository.insertEvent(event)
      return event
    })
  }
}
