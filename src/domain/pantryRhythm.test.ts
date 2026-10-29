import { describe, expect, it } from 'vitest'
import { addDays } from './dates.ts'
import { listaCompraTexto, monthlyEstimate, pantrySummary } from './pantry.ts'
import { agoText, durationText, itemRhythm, needsReview, rhythmsFor } from './pantryRhythm.ts'
import type { PantryEvent, PantryItem, PantryPurchase } from './types.ts'

const D0 = '2026-10-01'
const day = (n: number) => addDays(D0, n)

const buy = (n: number, overrides: Partial<PantryPurchase> = {}): PantryPurchase => ({
  itemId: 'leche',
  date: day(n),
  amount: null,
  measure: null,
  costCents: null,
  store: 'Lidl',
  ticketId: `t${n}`,
  recordedAt: `${day(n)}T18:00:00.000Z`,
  ...overrides,
})

let seq = 0
const mark = (n: number, kind: PantryEvent['kind'], hour = 20): PantryEvent => ({
  id: `e${++seq}`,
  itemId: 'leche',
  kind,
  date: day(n),
  createdAt: `${day(n)}T${String(hour).padStart(2, '0')}:00:00.000Z`,
})

const weekly = { frequency: 'semanal' as const }

describe('itemRhythm', () => {
  it('sin compras: sin datos, o «se acabó» si se ha marcado', () => {
    expect(itemRhythm(weekly, [], [], day(0))).toMatchObject({ status: 'sin_compras', expectedDays: 7, learned: false })
    expect(itemRhythm(weekly, [], [mark(0, 'se_acabo')], day(1)).status).toBe('se_acabo')
  })

  it('con una sola compra usa la frecuencia; con varias, la mediana de lo que dura', () => {
    expect(itemRhythm({ frequency: 'mensual' }, [buy(0)], [], day(5))).toMatchObject({ expectedDays: 30, learned: false, dueDate: day(30) })
    // Cada 6, 8 y 30 días (una vez se olvidó): la mediana es 8.
    const rhythm = itemRhythm(weekly, [buy(0), buy(6), buy(14), buy(44)], [], day(46))
    expect(rhythm).toMatchObject({ expectedDays: 8, learned: true, dueDate: day(52), sinceDays: 2, status: 'al_dia' })
    expect(rhythm.lastPurchase).toMatchObject({ date: day(44), store: 'Lidl' })
  })

  it('pasa de «al día» a «revisar» y a «probablemente se acabó»', () => {
    const purchases = [buy(0), buy(10), buy(20)]
    expect(itemRhythm(weekly, purchases, [], day(27)).status).toBe('al_dia')
    expect(itemRhythm(weekly, purchases, [], day(28)).status).toBe('revisar')
    expect(itemRhythm(weekly, purchases, [], day(30)).status).toBe('probablemente_acabado')
  })

  it('escala la duración con la cantidad comprada', () => {
    // 2 l duraron 7 días dos veces: 4 l durarán unos 14.
    const litres = (n: number, amount: number) => buy(n, { amount, measure: 'ud' })
    const rhythm = itemRhythm(weekly, [litres(0, 2), litres(7, 2), litres(14, 4)], [], day(15))
    expect(rhythm.expectedDays).toBe(14)
    expect(rhythm.dueDate).toBe(day(28))
  })

  it('«Se acabó» cierra el ciclo y cuenta para la próxima vez', () => {
    // Se acabó a los 4 días las dos veces: aunque se comprara cada 10, dura 4.
    const purchases = [buy(0), buy(10), buy(20)]
    const events = [mark(4, 'se_acabo'), mark(14, 'se_acabo')]
    expect(itemRhythm(weekly, purchases, events, day(21)).expectedDays).toBe(4)
    expect(itemRhythm(weekly, purchases, [...events, mark(22, 'se_acabo')], day(22)).status).toBe('se_acabo')
  })

  it('«Queda» pospone el aviso y enseña que dura más', () => {
    const purchases = [buy(0), buy(7)]
    expect(itemRhythm(weekly, purchases, [], day(14)).status).toBe('probablemente_acabado')
    // Pulsado «Queda» el día 14: pospone unos días.
    const after = itemRhythm(weekly, purchases, [mark(14, 'queda')], day(15))
    expect(after.status).toBe('al_dia')
    expect(after.dueDate).toBe(day(17))
    // Como quedaba, se volvió a comprar más tarde (día 18): el ritmo aprendido pasa de 7 a 9 días.
    expect(itemRhythm(weekly, [buy(0), buy(7), buy(18)], [mark(14, 'queda')], day(19)).expectedDays).toBe(9)
  })

  it('«Queda poco» lo pone en la lista, pero aprende como «Queda»', () => {
    const rhythm = itemRhythm(weekly, [buy(0)], [mark(5, 'poco')], day(5))
    expect(rhythm.status).toBe('queda_poco')
    expect(needsReview(rhythm)).toBe(false)
    // Se volvió a comprar el día 8: duró 8 días (el día 5 todavía quedaba).
    expect(itemRhythm(weekly, [buy(0), buy(8)], [mark(5, 'poco')], day(9))).toMatchObject({ status: 'al_dia', expectedDays: 8, learned: true })
    // Si después se pulsa «Queda», manda lo último.
    expect(itemRhythm(weekly, [buy(0)], [mark(5, 'poco'), mark(5, 'queda', 21)], day(5)).status).toBe('al_dia')
    // Y si se acaba, «Se acabó».
    expect(itemRhythm(weekly, [buy(0)], [mark(5, 'poco'), mark(6, 'se_acabo')], day(6)).status).toBe('se_acabo')
    // También sin compras apuntadas.
    expect(itemRhythm(weekly, [], [mark(1, 'poco')], day(1)).status).toBe('queda_poco')
  })

  it('una compra después de «Se acabó» lo deja al día; el mismo día cuenta el orden', () => {
    expect(itemRhythm(weekly, [buy(0), buy(9)], [mark(8, 'se_acabo')], day(9)).status).toBe('al_dia')
    // Se acabó por la mañana y se compró por la tarde: al día.
    expect(itemRhythm(weekly, [buy(9)], [mark(9, 'se_acabo', 9)], day(9)).status).toBe('al_dia')
    // Comprado y, más tarde, se acabó: se acabó.
    expect(itemRhythm(weekly, [buy(9)], [mark(9, 'se_acabo', 21)], day(9)).status).toBe('se_acabo')
  })

  it('«Lo he comprado» sin ticket cuenta como compra', () => {
    const rhythm = itemRhythm(weekly, [buy(0, { costCents: 95 })], [mark(7, 'comprado')], day(8))
    expect(rhythm).toMatchObject({ learned: true, expectedDays: 7, sinceDays: 1, lastCostCents: 95 })
    expect(rhythm.lastPurchase).toMatchObject({ date: day(7), store: null })
  })

  it('junta las compras del mismo día', () => {
    const rhythm = itemRhythm(
      weekly,
      [buy(0, { amount: 0.5, measure: 'kg', costCents: 400 }), buy(0, { amount: 0.6, measure: 'kg', costCents: 450, recordedAt: `${day(0)}T19:00:00.000Z` })],
      [],
      day(1),
    )
    expect(rhythm.lastPurchase).toMatchObject({ amount: 1.1, measure: 'kg', costCents: 850 })
  })
})

describe('textos del ritmo', () => {
  it('dice cuánto hace y cuánto dura de forma natural', () => {
    expect([0, 1, 6, 20, 90].map(agoText)).toEqual(['hoy', 'ayer', 'hace 6 días', 'hace 3 semanas', 'hace 3 meses'])
    expect([1, 7, 21, 120].map(durationText)).toEqual(['1 día', 'unos 7 días', 'unas 3 semanas', 'unos 4 meses'])
  })
})

describe('la despensa con productos que se siguen por compras', () => {
  const base: Omit<PantryItem, 'id' | 'name'> = {
    ownerId: null,
    unit: 'ud',
    tracking: 'compras',
    quantity: 0,
    target: 0,
    frequency: 'semanal',
    priceCents: null,
    notes: '',
    version: 1,
    createdAt: 'x',
    updatedAt: 'x',
  }
  const items: PantryItem[] = [
    { ...base, id: 'leche', name: 'Leche' },
    { ...base, id: 'pechuga', name: 'Filete de pechuga', unit: 'kg' },
    { ...base, id: 'sal', name: 'Sal', frequency: 'mensual' },
    { ...base, id: 'arroz', name: 'Arroz', tracking: 'cantidad', unit: 'kg', quantity: 0, target: 1, priceCents: 120, frequency: 'mensual' },
  ]
  const activity = {
    purchases: [
      buy(0, { itemId: 'leche', amount: 6, measure: 'ud' as const, costCents: 570 }),
      buy(0, { itemId: 'pechuga', amount: 1.1, measure: 'kg' as const, costCents: 850 }),
      buy(0, { itemId: 'sal', costCents: 40 }),
    ],
    events: [mark(3, 'se_acabo')],
  }
  const rhythms = rhythmsFor(items, activity, day(8))

  it('solo calcula el ritmo de los que se siguen por compras', () => {
    expect([...rhythms.keys()].sort()).toEqual(['leche', 'pechuga', 'sal'])
    expect(rhythms.get('leche')?.status).toBe('se_acabo')
    expect(rhythms.get('pechuga')?.status).toBe('probablemente_acabado')
    expect(rhythms.get('sal')?.status).toBe('al_dia')
    expect(needsReview(rhythms.get('pechuga'))).toBe(true)
    expect(needsReview(rhythms.get('leche'))).toBe(false)
  })

  it('la lista lleva lo que se acabó, lo que probablemente se acabó y lo que falta contar', () => {
    const text = listaCompraTexto(items, [], { date: day(8), owner: 'todo', frequencies: ['semanal', 'mensual', 'ocasional'] }, rhythms)
    expect(text).toBe(
      [
        '🛒 Lista de la compra · 09/10/2026',
        '',
        '*Compartido*',
        '• Filete de pechuga — 1,1 kg',
        '• Leche — 6 ud',
        '• Arroz — 1 kg',
        '',
        'Total estimado: 15,40 €',
      ].join('\n'),
    )
    expect(pantrySummary(items, 'todo', rhythms)).toEqual({ missingCount: 3, pendingCost: { cents: 1540, withoutPrice: 0 } })
  })

  it('estima el gasto mensual con lo que costó la última compra y lo que dura', () => {
    // Leche 5,70 € y se acabó a los 3 días → 57,59 €; pechuga 8,50 € cada 7 → 36,81 €;
    // sal 0,40 € cada 30 → 0,40 €; arroz 1 kg a 1,20 €/kg al mes → 1,20 €.
    expect(rhythms.get('leche')?.expectedDays).toBe(3)
    expect(monthlyEstimate(items, rhythms)).toEqual({ cents: 5759 + 3681 + 40 + 120, withoutPrice: 0 })
  })

  it('lo que «queda poco» va a la lista, con lo que se compró la última vez', () => {
    const bread: PantryItem[] = [{ ...base, id: 'pan', name: 'Pan', priceCents: 100 }]
    const breadRhythms = rhythmsFor(
      bread,
      { purchases: [buy(0, { itemId: 'pan', amount: 2, measure: 'ud' as const, costCents: 200 })], events: [{ ...mark(2, 'poco'), itemId: 'pan' }] },
      day(2),
    )
    expect(breadRhythms.get('pan')?.status).toBe('queda_poco')
    expect(listaCompraTexto(bread, [], { date: day(2), owner: 'todo', frequencies: ['semanal'] }, breadRhythms)).toBe(
      '🛒 Lista de la compra · 03/10/2026\n\n*Compartido*\n• Pan — 2 ud\n\nTotal estimado: 2,00 €',
    )
  })

  it('sin tickets todavía, usa el precio estimado de una unidad (no en g ni ml)', () => {
    const manual: PantryItem[] = [
      { ...base, id: 'pan', name: 'Pan', priceCents: 100 },
      { ...base, id: 'harina', name: 'Harina', unit: 'g', priceCents: 90 },
    ]
    const marks = { purchases: [], events: [{ ...mark(8, 'se_acabo'), itemId: 'pan' }] }
    const manualRhythms = rhythmsFor(manual, marks, day(8))
    // Pan: 1,00 € cada 7 días (semanal) → 4,33 € al mes; la harina no cuenta.
    expect(monthlyEstimate(manual, manualRhythms)).toEqual({ cents: 433, withoutPrice: 1 })
    expect(listaCompraTexto(manual, [], { date: day(8), owner: 'todo', frequencies: ['semanal'] }, manualRhythms)).toBe(
      '🛒 Lista de la compra · 09/10/2026\n\n*Compartido*\n• Pan\n\nTotal estimado: 1,00 €',
    )
  })
})
