import { describe, expect, it } from 'vitest'
import { categories, movement } from '../testing/factories.ts'
import { EMPTY_FILTERS, filterMovements } from './filters.ts'

const data = [
  movement({ concept: 'Café con Álvaro', categoryId: 'g-alimentacion-comidas-fuera', paidDate: '2026-10-05' }),
  movement({ concept: 'Mercadona', categoryId: 'g-alimentacion-supermercado', paidDate: '2026-10-12' }),
  movement({ concept: 'Gasolina', categoryId: 'g-coche-combustible', paidDate: '2026-09-20' }),
  movement({ concept: 'Nómina', type: 'ingreso', categoryId: 'i-nomina', paidDate: '2026-10-01' }),
  movement({ concept: 'Seguro hogar', categoryId: 'g-seguros-hogar', status: 'pendiente', paidDate: null, dueDate: '2026-11-15' }),
]

const run = (filters: Partial<typeof EMPTY_FILTERS>) =>
  filterMovements(data, categories(), { ...EMPTY_FILTERS, ...filters }).map((m) => m.concept)

describe('filterMovements', () => {
  it('ordena del más reciente al más antiguo', () => {
    expect(run({})).toEqual(['Seguro hogar', 'Mercadona', 'Café con Álvaro', 'Nómina', 'Gasolina'])
  })

  it('busca por concepto sin tildes ni mayúsculas', () => {
    expect(run({ text: 'alvaro' })).toEqual(['Café con Álvaro'])
    expect(run({ text: 'NÓMINA' })).toEqual(['Nómina'])
  })

  it('filtra por categoría principal incluyendo subcategorías', () => {
    expect(run({ categoryId: 'g-alimentacion' })).toEqual(['Mercadona', 'Café con Álvaro'])
    expect(run({ categoryId: 'g-alimentacion-supermercado' })).toEqual(['Mercadona'])
  })

  it('filtra por fechas, tipo y estado', () => {
    expect(run({ from: '2026-10-01', to: '2026-10-31' })).toEqual(['Mercadona', 'Café con Álvaro', 'Nómina'])
    expect(run({ type: 'ingreso' })).toEqual(['Nómina'])
    expect(run({ status: 'pendiente' })).toEqual(['Seguro hogar'])
  })
})
