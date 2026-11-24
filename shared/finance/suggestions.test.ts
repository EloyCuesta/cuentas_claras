import { describe, expect, it } from 'vitest'
import { movement } from '../testing/factories.ts'
import { categoryForConcept, conceptSuggestions, frequentCategories } from './suggestions.ts'

const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z`

describe('sugerencias para apuntar un movimiento', () => {
  const movements = [
    movement({ id: 'm1', concept: 'Mercadona', categoryId: 'super', updatedAt: at(1) }),
    movement({ id: 'm2', concept: 'Mercado de abastos', categoryId: 'fruta', updatedAt: at(5) }),
    movement({ id: 'm3', concept: 'mercadona', categoryId: 'hogar', updatedAt: at(3) }),
    movement({ id: 'm4', concept: 'Gasolinera', categoryId: 'coche', updatedAt: at(4) }),
    movement({ id: 'm5', concept: 'Nómina', categoryId: 'sueldo', type: 'ingreso', updatedAt: at(6) }),
  ]

  it('con el mismo concepto, la categoría de la última vez (sin mayúsculas ni tildes)', () => {
    expect(categoryForConcept(movements, 'MERCADONA', 'gasto')).toBe('hogar')
    expect(categoryForConcept(movements, 'nomina', 'ingreso')).toBe('sueldo')
    expect(categoryForConcept(movements, 'Nómina', 'gasto')).toBeNull()
  })

  it('sin uno igual, la del concepto más reciente que empieza por lo escrito, con al menos 3 letras', () => {
    // «Merc» lo empiezan «Mercadona» (día 3) y «Mercado de abastos» (día 5): manda el más reciente.
    expect(categoryForConcept(movements, 'Merc', 'gasto')).toBe('fruta')
    expect(categoryForConcept(movements, 'gaso', 'gasto')).toBe('coche')
    expect(categoryForConcept(movements, 'Me', 'gasto')).toBeNull()
    expect(categoryForConcept(movements, 'Panadería', 'gasto')).toBeNull()
    expect(categoryForConcept(movements, '   ', 'gasto')).toBeNull()
  })

  it('las categorías más usadas de un tipo, de más a menos, y solo las que existen', () => {
    const many = [
      ...movements,
      movement({ id: 'm6', concept: 'Gasolinera', categoryId: 'coche', updatedAt: at(7) }),
      movement({ id: 'm7', concept: 'Otra', categoryId: 'borrada', updatedAt: at(8) }),
    ]
    const allowed = new Set(['super', 'fruta', 'hogar', 'coche', 'sueldo'])
    // coche (2), y con uno: fruta (día 5), hogar (día 3) y super (día 1).
    expect(frequentCategories(many, 'gasto', allowed)).toEqual(['coche', 'fruta', 'hogar', 'super'])
    expect(frequentCategories(many, 'gasto', allowed, 2)).toEqual(['coche', 'fruta'])
    expect(frequentCategories(many, 'ingreso', allowed)).toEqual(['sueldo'])
    expect(frequentCategories([], 'gasto', allowed)).toEqual([])
  })

  it('conceptos distintos, del más reciente al más antiguo', () => {
    expect(conceptSuggestions(movements, 'gasto')).toEqual(['Mercado de abastos', 'Gasolinera', 'mercadona'])
  })
})
