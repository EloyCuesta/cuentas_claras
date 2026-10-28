import { withDescendants } from './categories.ts'
import { effectiveDate } from './summary.ts'
import type { Category, ISODate, Movement, MovementStatus, MovementType } from './types.ts'

export interface MovementFilters {
  /** Texto a buscar en el concepto (sin distinguir mayúsculas ni tildes). */
  text: string
  from: ISODate | ''
  to: ISODate | ''
  /** Categoría principal o subcategoría; '' = todas. */
  categoryId: string
  type: MovementType | ''
  status: MovementStatus | ''
}

export const EMPTY_FILTERS: MovementFilters = { text: '', from: '', to: '', categoryId: '', type: '', status: '' }

/** "Álvaro" -> "alvaro", para buscar sin tildes ni mayúsculas. */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

export function countActiveFilters(filters: MovementFilters): number {
  return Object.values(filters).filter((value) => value !== '').length
}

/** Aplica los filtros y ordena del más reciente al más antiguo. */
export function filterMovements(
  movements: readonly Movement[],
  categories: readonly Category[],
  filters: MovementFilters,
): Movement[] {
  const text = normalizeText(filters.text)
  const categoryIds = filters.categoryId ? new Set(withDescendants(categories, filters.categoryId)) : null

  return movements
    .filter((m) => {
      const date = effectiveDate(m)
      if (text && !normalizeText(m.concept).includes(text)) return false
      if (filters.from && date < filters.from) return false
      if (filters.to && date > filters.to) return false
      if (categoryIds && !categoryIds.has(m.categoryId)) return false
      if (filters.type && m.type !== filters.type) return false
      if (filters.status && m.status !== filters.status) return false
      return true
    })
    .sort((a, b) => effectiveDate(b).localeCompare(effectiveDate(a)) || b.createdAt.localeCompare(a.createdAt))
}
