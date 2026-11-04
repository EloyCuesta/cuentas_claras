import { planOccurrences } from '#shared/finance/recurring.ts'
import type { RecurringRule, SaveRecurringOptions } from '#shared/finance/types.ts'
import type { Clock, IdGenerator, UnitOfWork } from '../../../common/ports.ts'
import type { FinanceStore } from './ports.ts'
import { requireCategory } from './requireCategory.ts'

/**
 * Guardar un recurrente y rehacer sus vencimientos pendientes hasta `horizon`
 * con los datos nuevos; los ya pagados no se tocan. Con `markPaidBefore`, los
 * vencimientos anteriores a esa fecha se crean ya pagados (en su fecha): sirve
 * para dar de alta un préstamo empezado. Devuelve cuántos vencimientos ha creado.
 */
export class SaveRecurring {
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

  execute(rule: RecurringRule, options: SaveRecurringOptions): Promise<number> {
    // Con el bloqueo «finance», generar a la vez desde otra pestaña espera y no duplica (ni da 409).
    return this.unitOfWork.run(
      async () => {
        await requireCategory(this.store, rule.categoryId, rule.type, 'El recurrente')
        await this.store.upsertRule(rule)
        await this.store.clearExcludedDates(rule.id)
        for (const date of rule.excludedDates) await this.store.addExcludedDate(rule.id, date)

        // Los vencimientos pendientes se rehacen con los datos nuevos; los pagados se conservan.
        const kept = (await this.store.movementsOfRule(rule.id)).filter((m) => m.status !== 'pendiente')
        await this.store.deletePendingOfRule(rule.id)

        const planned = planOccurrences(rule, kept, options.horizon, this.clock.nowISO(), () => this.ids.newId())
        for (const movement of planned) {
          const paidAlready = options.markPaidBefore && (movement.occurrenceDate as string) < options.markPaidBefore
          // Un préstamo empezado: lo anterior a markPaidBefore se crea ya pagado, en su fecha.
          const occurrence = paidAlready
            ? { ...movement, status: 'realizado' as const, paidDate: movement.occurrenceDate }
            : movement
          await this.store.insertOccurrence(occurrence)
        }
        return planned.length
      },
      { lock: 'finance' },
    )
  }
}
