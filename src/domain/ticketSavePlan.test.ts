import { describe, expect, it } from 'vitest'
import { nameKey } from './ticketText.ts'
import { planTicketSave, priceFromLines, quantityFromLines } from './ticketSavePlan.ts'
import type { PantryItem, TicketDecision, TicketSaveInput, TicketSaveLine } from './types.ts'

const line = (overrides: Partial<TicketSaveLine> = {}): TicketSaveLine => ({
  rawName: 'Leche entera',
  quantity: 1,
  unitPriceCents: null,
  amountCents: 95,
  discountCents: 0,
  weightKg: null,
  pricePerKgCents: null,
  taxCode: 'A',
  occasional: false,
  ...overrides,
})

const item = (overrides: Partial<PantryItem> = {}): PantryItem => ({
  id: 'leche',
  name: 'Leche',
  ownerId: null,
  unit: 'ud',
  tracking: 'compras',
  quantity: 0,
  target: 0,
  frequency: 'semanal',
  priceCents: 90,
  notes: '',
  version: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
})

function input(lines: TicketSaveLine[], decisions: Record<string, TicketDecision>): TicketSaveInput {
  return { store: 'lidl', storeName: 'Lidl', address: '', date: '2026-10-29', time: '10:00', totalCents: null, lines, decisions }
}

const keyOf = (name: string) => nameKey(name)

describe('planTicketSave', () => {
  it('asocia un producto que ya existe: actualiza su precio y aprende el nombre', () => {
    const result = planTicketSave(input([line()], { [keyOf('Leche entera')]: { kind: 'item', itemId: 'leche' } }), [item()])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.newItems).toEqual([])
    expect(result.plan.updates).toEqual([{ itemId: 'leche', priceCents: 95, addQuantity: 1 }])
    expect(result.plan.aliases).toEqual([{ key: keyOf('Leche entera'), target: { kind: 'existing', itemId: 'leche' } }])
    expect(result.plan.lines[0]).toMatchObject({ reviewStatus: 'verified', target: { kind: 'existing', itemId: 'leche' } })
  })

  it('crea un solo producto nuevo para dos nombres con la misma decisión', () => {
    const lines = [line({ rawName: 'Pan barra' }), line({ rawName: 'Pan barra rustica', amountCents: 120 })]
    const decision: TicketDecision = { kind: 'new', name: 'Pan', ownerId: null, frequency: 'semanal' }
    const result = planTicketSave(input(lines, { [keyOf('Pan barra')]: decision, [keyOf('Pan barra rustica')]: decision }), [])
    if (!result.ok) throw new Error(result.error)
    expect(result.plan.newItems).toHaveLength(1)
    // El precio sale de la última línea fiable.
    expect(result.plan.newItems[0].input).toMatchObject({ name: 'Pan', unit: 'ud', tracking: 'compras', priceCents: 120 })
    const ref = result.plan.newItems[0].newRef
    expect(result.plan.lines.map((l) => l.target)).toEqual([
      { kind: 'new', newRef: ref },
      { kind: 'new', newRef: ref },
    ])
  })

  it('un producto nuevo de líneas con peso se crea en kg', () => {
    const weighed = line({ rawName: 'Platanos', weightKg: 0.544, pricePerKgCents: 675, amountCents: 367 })
    const result = planTicketSave(input([weighed], { [keyOf('Platanos')]: { kind: 'new', name: 'Plátanos', ownerId: null, frequency: 'semanal' } }), [])
    if (!result.ok) throw new Error(result.error)
    expect(result.plan.newItems[0].input).toMatchObject({ unit: 'kg', priceCents: 675 })
  })

  it('sin líneas fiables no crea nada ni aprende, pero guarda la línea como pendiente', () => {
    const doubtful = line({ amountCents: null })
    const result = planTicketSave(input([doubtful], { [keyOf('Leche entera')]: { kind: 'new', name: 'Leche', ownerId: null, frequency: 'semanal' } }), [])
    if (!result.ok) throw new Error(result.error)
    expect(result.plan.newItems).toEqual([])
    expect(result.plan.aliases).toEqual([])
    expect(result.plan.lines[0]).toMatchObject({ reviewStatus: 'pending', target: { kind: 'none' } })
  })

  it('«no seguir» se aprende como ignorado y no cambia ningún producto', () => {
    const result = planTicketSave(input([line({ rawName: 'Bolsa' })], { [keyOf('Bolsa')]: { kind: 'ignore' } }), [item()])
    if (!result.ok) throw new Error(result.error)
    expect(result.plan.updates).toEqual([])
    expect(result.plan.aliases).toEqual([{ key: keyOf('Bolsa'), target: { kind: 'none' } }])
  })

  it('una devolución no pendiente queda verificada pero no cambia el producto', () => {
    const refund = line({ amountCents: -95 })
    const result = planTicketSave(input([refund], { [keyOf('Leche entera')]: { kind: 'item', itemId: 'leche' } }), [item()])
    if (!result.ok) throw new Error(result.error)
    expect(result.plan.updates).toEqual([])
    expect(result.plan.lines[0].reviewStatus).toBe('verified')
  })

  it('rechaza una decisión que falta o un producto que ya no existe', () => {
    expect(planTicketSave(input([line()], {}), [])).toEqual({ ok: false, error: 'Falta qué hacer con «Leche entera».' })
    const gone = planTicketSave(input([line()], { [keyOf('Leche entera')]: { kind: 'item', itemId: 'borrado' } }), [item()])
    expect(gone.ok).toBe(false)
  })
})

describe('precio y cantidad desde las líneas', () => {
  it('por kilo en kg y g; por unidad en las unidades que se cuentan; nada si no encaja', () => {
    const weighed = [line({ weightKg: 0.5, pricePerKgCents: 400, amountCents: 200 })]
    expect(priceFromLines(weighed, 'kg')).toBe(400)
    expect(quantityFromLines(weighed, 'g')).toBe(500)
    expect(priceFromLines(weighed, 'ud')).toBeNull()
    const packs = [line({ quantity: 2, unitPriceCents: 150, amountCents: 300, discountCents: 50 })]
    expect(priceFromLines(packs, 'paquete')).toBe(125)
    expect(quantityFromLines(packs, 'paquete')).toBe(2)
    expect(quantityFromLines(packs, 'l')).toBeNull()
  })
})
