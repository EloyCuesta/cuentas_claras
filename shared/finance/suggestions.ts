import { normalizeText } from './filters.ts'
import type { Movement, MovementType } from './types.ts'

/**
 * Sugerencias para registrar más rápido: conceptos usados antes, la categoría
 * que se les dio la última vez y las categorías que más se usan.
 */

/** Conceptos distintos usados con un tipo, del más reciente al más antiguo. */
export function conceptSuggestions(movements: readonly Movement[], type: MovementType, limit = 50): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  const sorted = movements.filter((m) => m.type === type).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  for (const movement of sorted) {
    const key = normalizeText(movement.concept)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(movement.concept)
    if (result.length >= limit) break
  }
  return result
}

/** Lo mínimo que hay que escribir para sugerir por el principio del concepto («Mer» → «Mercadona»). */
export const PREFIX_MIN_LENGTH = 3

/**
 * Categoría usada la última vez con ese mismo concepto. Si no hay ninguno igual, la del concepto más reciente que
 * empieza por lo escrito (con al menos 3 letras): «Merca» sugiere la de «Mercadona». null si no hay ninguno.
 */
export function categoryForConcept(movements: readonly Movement[], concept: string, type: MovementType): string | null {
  const key = normalizeText(concept)
  if (!key) return null
  let exact: Movement | null = null
  let prefix: Movement | null = null
  for (const movement of movements) {
    if (movement.type !== type) continue
    const other = normalizeText(movement.concept)
    if (other === key) {
      if (!exact || movement.updatedAt > exact.updatedAt) exact = movement
    } else if (key.length >= PREFIX_MIN_LENGTH && other.startsWith(key)) {
      if (!prefix || movement.updatedAt > prefix.updatedAt) prefix = movement
    }
  }
  return (exact ?? prefix)?.categoryId ?? null
}

/**
 * Las categorías más usadas con un tipo, de más a menos movimientos (y, a igualdad, la usada más recientemente),
 * para elegirlas con un toque. Solo las de `allowed` (las que existen y son de ese tipo).
 */
export function frequentCategories(movements: readonly Movement[], type: MovementType, allowed: ReadonlySet<string>, limit = 6): string[] {
  const stats = new Map<string, { count: number; last: string }>()
  for (const movement of movements) {
    if (movement.type !== type || !allowed.has(movement.categoryId)) continue
    const current = stats.get(movement.categoryId)
    if (current) {
      current.count++
      if (movement.updatedAt > current.last) current.last = movement.updatedAt
    } else stats.set(movement.categoryId, { count: 1, last: movement.updatedAt })
  }
  return [...stats.entries()]
    .sort(([a, x], [b, y]) => y.count - x.count || y.last.localeCompare(x.last) || a.localeCompare(b))
    .slice(0, limit)
    .map(([id]) => id)
}
