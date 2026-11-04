import type { ISODate } from '#shared/common/types.ts'
import { planOccurrences } from '#shared/finance/recurring.ts'
import type { Clock, IdGenerator, UnitOfWork } from '../../../common/ports.ts'
import type { FinanceStore } from './ports.ts'

/**
 * Crear los vencimientos que falten hasta `horizon` (el final del mes
 * siguiente, que calcula la web con su fecha de hoy). Nunca duplica: lo ya
 * creado y las fechas excluidas se saltan. Si dos pestañas generan a la vez,
 * el bloqueo «finance» las pone en serie y la segunda ve lo que creó la
 * primera (crea 0, sin 409); el índice único (recurrente + fecha) lo impide
 * además en la base de datos. Devuelve cuántos ha creado.
 */
export class GenerateOccurrences {
  private readonly store: FinanceStore
  private readonly clock: Clock
  private readonly ids: IdGenerator
  private readonly unitOfWork: UnitOfWork

  constructor(store: FinanceStore, clock: Clock, ids: IdGenerator, unitOfWork: UnitOfWork) {
    this.store = store
    this.clock = clock
    this.ids = ids
    this.unitOfWork = unitOfWork
  }

  execute(horizon: ISODate): Promise<number> {
    return this.unitOfWork.run(
      async () => {
        const now = this.clock.nowISO()
        let created = 0
        for (const rule of await this.store.listRules()) {
          const own = await this.store.movementsOfRule(rule.id)
          for (const movement of planOccurrences(rule, own, horizon, now, () => this.ids.newId())) {
            await this.store.insertOccurrence(movement)
            created++
          }
        }
        return created
      },
      { lock: 'finance' },
    )
  }
}
