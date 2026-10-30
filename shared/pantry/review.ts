import { addDays, daysBetween } from '../core/dates.ts'
import type { ISODate } from '../core/types.ts'
import { type Rhythms, sortItems } from './pantry.ts'
import { isCounted } from './tracking.ts'
import type { PantryItem, PantryPurchase } from './types.ts'

/**
 * Repaso de la semana: una vez a la semana, en un par de minutos, se mira lo
 * que puede acabarse antes de la próxima compra y la lista queda hecha.
 *
 * Funciones puras: la fecha de hoy se recibe como parámetro.
 */

/** Cada cuántos días toca el repaso, y hasta dónde mira: lo que puede acabarse antes del siguiente. */
export const REVIEW_INTERVAL_DAYS = 7

export interface ReviewSchedule {
  /** ¿Toca hacer el repaso? */
  due: boolean
  /** Días desde el último repaso; null si todavía no se ha hecho ninguno. */
  sinceDays: number | null
}

/**
 * Toca el repaso cuando han pasado 7 días desde el anterior. Si no se ha hecho
 * nunca, a los 7 días de empezar a usar la despensa (el primer producto o la
 * primera compra), para que no salte nada más empezar.
 */
export function reviewSchedule(
  lastReviewDate: ISODate | null,
  items: readonly Pick<PantryItem, 'createdAt'>[],
  purchases: readonly Pick<PantryPurchase, 'date'>[],
  today: ISODate,
): ReviewSchedule {
  if (items.length === 0) return { due: false, sinceDays: null }
  if (lastReviewDate !== null) {
    const since = daysBetween(lastReviewDate, today)
    return { due: since >= REVIEW_INTERVAL_DAYS, sinceDays: since }
  }
  const dates = [...items.map((item) => item.createdAt.slice(0, 10)), ...purchases.map((purchase) => purchase.date)]
  const first = dates.sort()[0]
  return { due: daysBetween(first, today) >= REVIEW_INTERVAL_DAYS, sinceDays: null }
}

/**
 * Lo que se repasa, en este orden:
 * 1. Lo que ya conviene mirar («Probablemente se acabó», «Revisar pronto»), lo más atrasado primero.
 * 2. Lo que puede acabarse antes del próximo repaso (en los próximos 7 días).
 * 3. Lo que se sigue por compras sin ninguna compra apuntada: no hay forma de saberlo.
 * 4. Lo que se cuenta, para poner al día cuánto hay.
 *
 * No se pregunta por lo que ya está en la lista («Se acabó», «Queda poco») ni
 * por lo comprado hoy o ayer.
 */
export function reviewItems(items: readonly PantryItem[], rhythms: Rhythms, today: ISODate): PantryItem[] {
  const horizon = addDays(today, REVIEW_INTERVAL_DAYS)
  const byDue = (a: PantryItem, b: PantryItem) =>
    (rhythms.get(a.id)?.dueDate ?? '').localeCompare(rhythms.get(b.id)?.dueDate ?? '') || a.name.localeCompare(b.name, 'es')

  const toCheck: PantryItem[] = []
  const soon: PantryItem[] = []
  const unknown: PantryItem[] = []
  for (const item of items) {
    if (isCounted(item)) continue
    const rhythm = rhythms.get(item.id)
    if (!rhythm || rhythm.status === 'sin_compras') unknown.push(item)
    else if (rhythm.status === 'revisar' || rhythm.status === 'probablemente_acabado') toCheck.push(item)
    else if (rhythm.status === 'al_dia' && rhythm.sinceDays !== null && rhythm.sinceDays >= 2 && rhythm.dueDate !== null && rhythm.dueDate <= horizon) {
      soon.push(item)
    }
  }
  const counted = sortItems(items.filter(isCounted))
  return [...toCheck.sort(byDue), ...soon.sort(byDue), ...unknown.sort((a, b) => a.name.localeCompare(b.name, 'es')), ...counted]
}
