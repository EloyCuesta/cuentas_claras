import type { Category, MovementType } from './types.ts'

/** Separador entre categoría y subcategoría en los textos: "Vivienda › Luz". */
export const PATH_SEPARATOR = ' › '

interface SeedCategory {
  slug: string
  name: string
  children?: { slug: string; name: string }[]
}

const EXPENSE_SEED: SeedCategory[] = [
  {
    slug: 'vivienda',
    name: 'Vivienda',
    children: [
      { slug: 'alquiler', name: 'Alquiler o hipoteca' },
      { slug: 'luz', name: 'Luz' },
      { slug: 'agua', name: 'Agua' },
      { slug: 'gas', name: 'Gas' },
      { slug: 'internet', name: 'Internet' },
    ],
  },
  {
    slug: 'coche',
    name: 'Coche',
    children: [
      { slug: 'combustible', name: 'Combustible' },
      { slug: 'mantenimiento', name: 'Mantenimiento' },
      { slug: 'aparcamiento', name: 'Aparcamiento' },
      { slug: 'impuestos', name: 'Impuestos' },
    ],
  },
  {
    slug: 'alimentacion',
    name: 'Alimentación',
    children: [
      { slug: 'supermercado', name: 'Supermercado' },
      { slug: 'comidas-fuera', name: 'Comidas fuera' },
    ],
  },
  {
    slug: 'seguros',
    name: 'Seguros',
    children: [
      { slug: 'coche', name: 'Coche' },
      { slug: 'hogar', name: 'Hogar' },
      { slug: 'salud', name: 'Salud' },
      { slug: 'otros', name: 'Otros' },
    ],
  },
  { slug: 'prestamos', name: 'Préstamos y letras' },
  { slug: 'suscripciones', name: 'Suscripciones' },
  { slug: 'salud', name: 'Salud' },
  { slug: 'ocio', name: 'Ocio' },
  { slug: 'otros', name: 'Otros' },
]

const INCOME_SEED: SeedCategory[] = [
  { slug: 'nomina', name: 'Nómina' },
  { slug: 'extra', name: 'Ingresos extra' },
  { slug: 'otros', name: 'Otros ingresos' },
]

function expandSeed(type: MovementType, seed: SeedCategory[]): Category[] {
  const prefix = type === 'gasto' ? 'g' : 'i'
  const result: Category[] = []
  seed.forEach((parent, parentIndex) => {
    const parentId = `${prefix}-${parent.slug}`
    result.push({ id: parentId, name: parent.name, type, parentId: null, order: parentIndex, budgetCents: null })
    parent.children?.forEach((child, childIndex) => {
      result.push({
        id: `${parentId}-${child.slug}`,
        name: child.name,
        type,
        parentId,
        order: childIndex,
        budgetCents: null,
      })
    })
  })
  return result
}

/** Categorías con las que empieza la aplicación (el usuario puede editarlas). */
export const DEFAULT_CATEGORIES: readonly Category[] = [
  ...expandSeed('gasto', EXPENSE_SEED),
  ...expandSeed('ingreso', INCOME_SEED),
]

export type CategoryMap = ReadonlyMap<string, Category>

export function indexCategories(categories: readonly Category[]): CategoryMap {
  return new Map(categories.map((category) => [category.id, category]))
}

/** Id de la categoría principal (la propia si ya es principal). */
export function topLevelId(categoryId: string, map: CategoryMap): string {
  const category = map.get(categoryId)
  return category?.parentId ?? categoryId
}

/** "Vivienda › Luz" o "Ocio". */
export function categoryPath(categoryId: string, map: CategoryMap): string {
  const category = map.get(categoryId)
  if (!category) return 'Sin categoría'
  const parent = category.parentId ? map.get(category.parentId) : undefined
  return parent ? `${parent.name}${PATH_SEPARATOR}${category.name}` : category.name
}

const byOrder = (a: Category, b: Category) => a.order - b.order || a.name.localeCompare(b.name, 'es')

/** Categorías principales de un tipo, ordenadas. */
export function topLevelCategories(categories: readonly Category[], type: MovementType): Category[] {
  return categories.filter((c) => c.type === type && c.parentId === null).sort(byOrder)
}

export function childrenOf(categories: readonly Category[], parentId: string): Category[] {
  return categories.filter((c) => c.parentId === parentId).sort(byOrder)
}

export interface CategoryOption {
  id: string
  label: string
  isChild: boolean
}

/** Opciones para un desplegable: cada principal seguida de sus subcategorías. */
export function categoryOptions(categories: readonly Category[], type: MovementType): CategoryOption[] {
  const options: CategoryOption[] = []
  for (const parent of topLevelCategories(categories, type)) {
    options.push({ id: parent.id, label: parent.name, isChild: false })
    for (const child of childrenOf(categories, parent.id)) {
      options.push({ id: child.id, label: `${parent.name}${PATH_SEPARATOR}${child.name}`, isChild: true })
    }
  }
  return options
}

/** La categoría y todas sus subcategorías. */
export function withDescendants(categories: readonly Category[], categoryId: string): string[] {
  return [categoryId, ...categories.filter((c) => c.parentId === categoryId).map((c) => c.id)]
}

/** Siguiente número de orden libre dentro de un grupo. */
export function nextOrder(categories: readonly Category[], type: MovementType, parentId: string | null): number {
  const siblings = categories.filter((c) => c.type === type && c.parentId === parentId)
  return siblings.reduce((max, c) => Math.max(max, c.order + 1), 0)
}
