import { describe, expect, it } from 'vitest'
import { addDays } from '../core/dates.ts'
import { reviewItems, reviewSchedule } from './review.ts'
import { rhythmsFor } from './rhythm.ts'
import type { PantryEvent, PantryItem, PantryPurchase } from './types.ts'

const D0 = '2026-10-01'
const day = (n: number) => addDays(D0, n)

const base: PantryItem = {
  id: 'x',
  name: 'X',
  ownerId: null,
  unit: 'ud',
  tracking: 'compras',
  quantity: 0,
  target: 0,
  frequency: 'semanal',
  priceCents: null,
  notes: '',
  version: 1,
  createdAt: `${D0}T09:00:00.000Z`,
  updatedAt: `${D0}T09:00:00.000Z`,
}
const item = (id: string, overrides: Partial<PantryItem> = {}): PantryItem => ({ ...base, id, name: id, ...overrides })
const buy = (itemId: string, n: number): PantryPurchase => ({
  itemId,
  date: day(n),
  amount: null,
  measure: null,
  costCents: null,
  store: 'Lidl',
  ticketId: `t${n}`,
  recordedAt: `${day(n)}T18:00:00.000Z`,
})
const mark = (itemId: string, n: number, kind: PantryEvent['kind']): PantryEvent => ({
  id: `${itemId}-${n}-${kind}`,
  itemId,
  kind,
  date: day(n),
  createdAt: `${day(n)}T20:00:00.000Z`,
})

describe('reviewSchedule', () => {
  it('toca a los 7 días del último repaso', () => {
    expect(reviewSchedule(day(0), [base], [], day(6))).toEqual({ due: false, sinceDays: 6 })
    expect(reviewSchedule(day(0), [base], [], day(7))).toEqual({ due: true, sinceDays: 7 })
    expect(reviewSchedule(day(0), [base], [], day(0))).toEqual({ due: false, sinceDays: 0 })
  })

  it('si no se ha hecho nunca, a los 7 días de empezar; sin productos, nunca', () => {
    expect(reviewSchedule(null, [], [], day(30)).due).toBe(false)
    const created = item('a', { createdAt: `${day(3)}T10:00:00.000Z` })
    expect(reviewSchedule(null, [created], [], day(9))).toEqual({ due: false, sinceDays: null })
    expect(reviewSchedule(null, [created], [], day(10))).toEqual({ due: true, sinceDays: null })
    // Un ticket de hace días cuenta como el principio, aunque el producto se creara hoy.
    expect(reviewSchedule(null, [item('b', { createdAt: `${day(9)}T10:00:00.000Z` })], [{ date: day(2) }], day(9)).due).toBe(true)
  })
})

describe('reviewItems', () => {
  // Hoy es el día 10; lo semanal dura 7 días mientras no se aprenda otra cosa.
  const items = [
    item('pan'), // comprado el día 3: se acaba hoy → para revisar
    item('leche'), // comprado el día 6: se acabará el 13, antes del próximo repaso
    item('arroz', { frequency: 'mensual' }), // comprado el día 6: dura hasta el 36
    item('huevos'), // comprado ayer: no se pregunta
    item('yogur'), // «Se acabó»: ya está en la lista
    item('queso'), // «Queda poco»: ya está en la lista
    item('sal'), // sin compras: no hay forma de saberlo
    item('aceite', { tracking: 'cantidad', unit: 'l', quantity: 1, target: 2, frequency: 'mensual' }),
    item('agua', { tracking: 'cantidad', quantity: 6, target: 6 }),
    item('fruta'), // comprada el día 1: la más atrasada
  ]
  const activity = {
    purchases: [buy('pan', 3), buy('leche', 6), buy('arroz', 6), buy('huevos', 9), buy('yogur', 6), buy('queso', 6), buy('fruta', 1)],
    events: [mark('yogur', 8, 'se_acabo'), mark('queso', 8, 'poco')],
  }
  const rhythms = rhythmsFor(items, activity, day(10))

  it('primero lo atrasado, luego lo que puede acabarse esta semana, lo desconocido y lo que se cuenta', () => {
    expect(reviewItems(items, rhythms, day(10)).map((i) => i.id)).toEqual(['fruta', 'pan', 'leche', 'sal', 'agua', 'aceite'])
  })

  it('justo después de comprar no queda nada por repasar salvo lo que se cuenta', () => {
    const fresh = [item('pan'), item('leche'), item('agua', { tracking: 'cantidad', quantity: 6, target: 6 })]
    const today = day(4)
    const freshRhythms = rhythmsFor(fresh, { purchases: [buy('pan', 3), buy('leche', 4)], events: [] }, today)
    expect(reviewItems(fresh, freshRhythms, today).map((i) => i.id)).toEqual(['agua'])
  })
})
