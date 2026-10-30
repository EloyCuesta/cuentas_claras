import { describe, expect, it } from 'vitest'
import {
  checkQuantity,
  describeQuantity,
  excessQuantity,
  formatQuantity,
  listaCompraTexto,
  missingCostCents,
  missingQuantity,
  monthlyCostCents,
  monthlyEstimate,
  pantrySummary,
  priceUnitLabel,
  shoppingListItems,
  stepQuantity,
  whatsAppUrl,
  type ShoppingListFilter,
} from './pantry.ts'
import type { PantryItem, PantryPerson } from './types.ts'
import { parsePantryCentsInput, parseQuantityInput, validateItemDraft, validateItemInput } from './validation.ts'

let seq = 0
function item(overrides: Partial<PantryItem> = {}): PantryItem {
  seq++
  return {
    id: `i${String(seq).padStart(3, '0')}`,
    name: `Producto ${seq}`,
    ownerId: null,
    unit: 'ud',
    tracking: 'cantidad',
    quantity: 0,
    target: 1,
    frequency: 'semanal',
    priceCents: null,
    notes: '',
    version: 1,
    createdAt: '2026-10-29T08:00:00.000Z',
    updatedAt: '2026-10-29T08:00:00.000Z',
    ...overrides,
  }
}

const eloy: PantryPerson = { id: 'p-eloy', name: 'Eloy', createdAt: 'x' }
const ana: PantryPerson = { id: 'p-ana', name: 'Ana', createdAt: 'x' }

const ALL: ShoppingListFilter = { date: '2026-10-29', owner: 'todo', frequencies: ['semanal', 'mensual', 'ocasional'] }

/** Los datos del ejemplo de la lista de la compra. */
const example = () => [
  item({ name: 'Leche', unit: 'l', quantity: 2, target: 6, frequency: 'semanal', priceCents: 95 }),
  item({ name: 'Huevos', unit: 'docena', quantity: 0, target: 1, frequency: 'mensual', priceCents: 260 }),
  item({ name: 'Proteína', ownerId: eloy.id, unit: 'bolsa', quantity: 0, target: 1, frequency: 'mensual', priceCents: 1200 }),
]

describe('cantidades', () => {
  it('lo que falta, con existencias por debajo, iguales y por encima del objetivo', () => {
    expect(missingQuantity({ quantity: 2, target: 6 })).toBe(4)
    expect(missingQuantity({ quantity: 6, target: 6 })).toBe(0)
    expect(missingQuantity({ quantity: 9, target: 6 })).toBe(0)
    expect(excessQuantity({ quantity: 9, target: 6 })).toBe(3)
  })

  it('no deja restos binarios ni faltantes ficticios', () => {
    expect(missingQuantity({ quantity: 0.1 + 0.2, target: 0.3 })).toBe(0)
    expect(missingQuantity({ quantity: 0.1, target: 0.3 })).toBe(0.2)
    expect(stepQuantity(0.1 + 0.2, 0.5)).toBe(0.8)
    expect(checkQuantity(0.1 + 0.2, 'kg')).toEqual({ ok: true, value: 0.3 })
  })

  it('los botones suman o restan según la unidad y nunca bajan de cero', () => {
    expect(stepQuantity(0.3, -0.5)).toBe(0)
    expect(stepQuantity(250, 100)).toBe(350)
    expect(stepQuantity(1, -1)).toBe(0)
    expect(stepQuantity(5, 1)).toBe(6)
  })

  it('valida decimales solo en g, kg, ml y l, sin redondear a escondidas', () => {
    expect(checkQuantity(1.5, 'kg').ok).toBe(true)
    expect(checkQuantity(1.5, 'ud')).toEqual({ ok: false, error: 'En «ud» la cantidad tiene que ser un número entero.' })
    expect(checkQuantity(0.1234, 'kg')).toEqual({ ok: false, error: 'Usa como máximo 3 decimales.' })
    expect(checkQuantity(-1, 'g').ok).toBe(false)
    expect(checkQuantity(Number.NaN, 'g').ok).toBe(false)
    expect(checkQuantity(Number.POSITIVE_INFINITY, 'g').ok).toBe(false)
    expect(checkQuantity(2_000_000, 'g').ok).toBe(false)
  })

  it('formatea sin ceros de más y con coma decimal', () => {
    expect(formatQuantity(4)).toBe('4')
    expect(formatQuantity(1.5)).toBe('1,5')
    expect(formatQuantity(0.25)).toBe('0,25')
    expect(describeQuantity(1, 'docena')).toBe('1 docena')
    expect(describeQuantity(2, 'docena')).toBe('2 docenas')
    expect(describeQuantity(1.5, 'l')).toBe('1,5 l')
    expect(priceUnitLabel('g')).toBe('€/kg')
    expect(priceUnitLabel('ml')).toBe('€/l')
    expect(priceUnitLabel('paquete')).toBe('€/paquete')
  })
})

describe('importes', () => {
  it('coste de lo que falta: null sin precio, 0 con precio 0', () => {
    expect(missingCostCents(item({ quantity: 2, target: 6, unit: 'l', priceCents: 95 }))).toBe(380)
    expect(missingCostCents(item({ priceCents: null }))).toBeNull()
    expect(missingCostCents(item({ priceCents: 0 }))).toBe(0)
  })

  it('en g y ml el precio es por kilo o por litro, y las fracciones de céntimo se redondean una vez', () => {
    // 250 g a 1,20 €/kg = 0,30 €
    expect(missingCostCents(item({ unit: 'g', quantity: 0, target: 250, priceCents: 120 }))).toBe(30)
    // 0,125 kg a 0,99 €/kg = 12,375 céntimos → 12
    expect(missingCostCents(item({ unit: 'kg', quantity: 0, target: 0.125, priceCents: 99 }))).toBe(12)
    // 0,5 kg a 0,99 €/kg = 49,5 céntimos → 50 (mitades hacia arriba)
    expect(missingCostCents(item({ unit: 'kg', quantity: 0, target: 0.5, priceCents: 99 }))).toBe(50)
  })

  it('estimación mensual: objetivo × precio × 4,33, 1 o 0,25, redondeando al final', () => {
    expect(monthlyCostCents(item({ target: 1, priceCents: 100, frequency: 'semanal' }))).toBe(433)
    expect(monthlyCostCents(item({ target: 3, priceCents: 100, frequency: 'mensual' }))).toBe(300)
    expect(monthlyCostCents(item({ target: 1, priceCents: 150, frequency: 'ocasional' }))).toBe(38) // 37,5 → 38
    // Usa el objetivo, no lo que hay ni lo que falta.
    expect(monthlyCostCents(item({ quantity: 10, target: 2, priceCents: 100, frequency: 'mensual' }))).toBe(200)
    // 1 ud a 0,01 € semanal = 4,33 céntimos → 4 (el factor se aplica antes de redondear)
    expect(monthlyCostCents(item({ target: 1, priceCents: 1, frequency: 'semanal' }))).toBe(4)
  })

  it('suma las líneas ya redondeadas y avisa de los precios que faltan', () => {
    const items = [
      item({ target: 1, priceCents: 1, frequency: 'semanal' }), // 4,33 → 4
      item({ target: 1, priceCents: 1, frequency: 'semanal' }), // 4,33 → 4
      item({ target: 1, priceCents: null }),
      item({ target: 1, priceCents: 0 }),
    ]
    expect(monthlyEstimate(items)).toEqual({ cents: 8, withoutPrice: 1 })
  })

  it('el resumen cuenta productos que faltan (no cantidades) del dueño elegido', () => {
    const items = [
      item({ quantity: 0, target: 10, priceCents: 100 }),
      item({ quantity: 5, target: 5, priceCents: 100 }),
      item({ quantity: 0, target: 1, priceCents: null }),
      item({ ownerId: eloy.id, quantity: 0, target: 2, priceCents: 50 }),
    ]
    expect(pantrySummary(items, 'compartido')).toEqual({ missingCount: 2, pendingCost: { cents: 1000, withoutPrice: 1 } })
    expect(pantrySummary(items, { personId: eloy.id })).toEqual({ missingCount: 1, pendingCost: { cents: 100, withoutPrice: 0 } })
    expect(pantrySummary(items, 'todo').missingCount).toBe(3)
  })
})

describe('lista de la compra', () => {
  it('produce exactamente el texto del ejemplo', () => {
    expect(listaCompraTexto(example(), [eloy], ALL)).toBe(
      [
        '🛒 Lista de la compra · 29/10/2026',
        '',
        '*Compartido*',
        '• Leche — 4 l',
        '• Huevos — 1 docena',
        '',
        '*Eloy*',
        '• Proteína — 1 bolsa',
        '',
        'Total estimado: 18,40 €',
      ].join('\n'),
    )
  })

  it('ordena Compartido y luego personas por nombre; dentro, semanal, mensual, ocasional y nombre', () => {
    const items = [
      item({ name: 'Zumo', frequency: 'ocasional' }),
      item({ name: 'arroz', frequency: 'mensual' }),
      item({ name: 'Pan', frequency: 'semanal' }),
      item({ name: 'Agua', frequency: 'semanal' }),
      item({ name: 'Café', ownerId: eloy.id }),
      item({ name: 'Té', ownerId: ana.id }),
    ]
    const text = listaCompraTexto(items, [eloy, ana], ALL)
    expect(text.split('\n').slice(2)).toEqual([
      '*Compartido*',
      '• Agua — 1 ud',
      '• Pan — 1 ud',
      '• arroz — 1 ud',
      '• Zumo — 1 ud',
      '',
      '*Ana*',
      '• Té — 1 ud',
      '',
      '*Eloy*',
      '• Café — 1 ud',
    ])
  })

  it('filtra por dueño y frecuencia, solo lo que falta, y omite los grupos vacíos', () => {
    const items = [...example(), item({ name: 'Sal', quantity: 1, target: 1 })]
    const onlyEloy = listaCompraTexto(items, [eloy, ana], { ...ALL, owner: { personId: eloy.id } })
    expect(onlyEloy).toBe('🛒 Lista de la compra · 29/10/2026\n\n*Eloy*\n• Proteína — 1 bolsa\n\nTotal estimado: 12,00 €')
    const weekly = shoppingListItems(items, { ...ALL, frequencies: ['semanal'] })
    expect(weekly.map((i) => i.name)).toEqual(['Leche'])
    expect(listaCompraTexto(items, [eloy], ALL)).not.toContain('Sal')
    expect(listaCompraTexto(items, [eloy, ana], ALL)).not.toContain('*Ana*')
  })

  it('total completo, parcial o ausente; sin total en una lista vacía', () => {
    const priced = item({ name: 'A', priceCents: 100 })
    const unpriced = item({ name: 'B', priceCents: null })
    expect(listaCompraTexto([priced, unpriced], [], ALL)).toMatch(/\n\nTotal estimado parcial: 1,00 €$/)
    expect(listaCompraTexto([unpriced], [], ALL)).not.toMatch(/Total/)
    expect(listaCompraTexto([item({ name: 'C', priceCents: 0 })], [], ALL)).toMatch(/Total estimado: 0,00 €$/)
    expect(listaCompraTexto([], [], ALL)).toBe('🛒 Lista de la compra · 29/10/2026\n\nNo falta nada.')
  })

  it('el enlace de WhatsApp lleva el texto codificado', () => {
    const text = listaCompraTexto(example(), [eloy], ALL)
    const url = whatsAppUrl(text)
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
    expect(decodeURIComponent(url.slice('https://wa.me/?text='.length))).toBe(text)
  })
})

describe('validación de la despensa', () => {
  it('lee cantidades con coma o punto y rechaza lo demás', () => {
    expect(parseQuantityInput('1,5')).toEqual({ ok: true, value: 1.5 })
    expect(parseQuantityInput('0.25')).toEqual({ ok: true, value: 0.25 })
    expect(parseQuantityInput('').ok).toBe(false)
    expect(parseQuantityInput('-2').ok).toBe(false)
    expect(parseQuantityInput('1.500,5').ok).toBe(false)
    expect(parseQuantityInput('1,2345').ok).toBe(false)
  })

  it('distingue precio vacío (desconocido) de 0 € (conocido)', () => {
    expect(parsePantryCentsInput('')).toEqual({ ok: true, value: null })
    expect(parsePantryCentsInput('0')).toEqual({ ok: true, value: 0 })
    expect(parsePantryCentsInput('0,00')).toEqual({ ok: true, value: 0 })
    expect(parsePantryCentsInput('1,20')).toEqual({ ok: true, value: 120 })
    expect(parsePantryCentsInput('-1').ok).toBe(false)
    expect(parsePantryCentsInput('200000').ok).toBe(false)
  })

  it('al cambiar la unidad vuelve a comprobar las dos cantidades', () => {
    const draft = {
      name: 'Arroz',
      ownerId: '',
      unit: 'kg' as const,
      tracking: 'cantidad' as const,
      quantity: '1,5',
      target: '2',
      frequency: 'mensual' as const,
      price: '',
      notes: '',
    }
    expect(validateItemDraft(draft, []).ok).toBe(true)
    const result = validateItemDraft({ ...draft, unit: 'paquete' }, [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toEqual({ quantity: 'En «paquete» la cantidad tiene que ser un número entero.' })
    expect(validateItemDraft({ ...draft, ownerId: 'no-existe' }, []).ok).toBe(false)
  })

  it('valida lo que llega a la API: campos conocidos, unidades, frecuencias y límites', () => {
    const base = { name: '  Leche ', ownerId: null, unit: 'l', quantity: 2, target: 6, frequency: 'semanal', priceCents: 95, notes: '' }
    expect(validateItemInput(base)).toEqual({ ok: true, value: { ...base, name: 'Leche', tracking: 'cantidad' } })
    expect(validateItemInput({ ...base, extra: 'x', notes: undefined })).toEqual({
      ok: true,
      value: { ...base, name: 'Leche', notes: '', tracking: 'cantidad' },
    })
    expect(validateItemInput({ ...base, tracking: 'compras' })).toMatchObject({ ok: true, value: { tracking: 'compras' } })
    expect(validateItemInput({ ...base, tracking: 'otra' }).ok).toBe(false)
    expect(validateItemInput({ ...base, unit: 'barril' }).ok).toBe(false)
    expect(validateItemInput({ ...base, frequency: 'diaria' }).ok).toBe(false)
    expect(validateItemInput({ ...base, quantity: -1 }).ok).toBe(false)
    expect(validateItemInput({ ...base, target: '6' }).ok).toBe(false)
    expect(validateItemInput({ ...base, priceCents: 9.5 }).ok).toBe(false)
    expect(validateItemInput({ ...base, priceCents: -1 }).ok).toBe(false)
    expect(validateItemInput({ ...base, name: '   ' }).ok).toBe(false)
    expect(validateItemInput({ ...base, name: 'x'.repeat(81) }).ok).toBe(false)
    expect(validateItemInput({ ...base, notes: 'x'.repeat(121) }).ok).toBe(false)
    expect(validateItemInput({ ...base, unit: 'docena', quantity: 0.5 }).ok).toBe(false)
  })
})
