import { normalizeText } from './filters.ts'
import type { Movement, MovementType } from './types.ts'

/**
 * Sugerencias para registrar más rápido: conceptos usados antes y la categoría
 * que se les dio la última vez.
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

/** Categoría usada la última vez con ese mismo concepto (o null). */
export function categoryForConcept(movements: readonly Movement[], concept: string, type: MovementType): string | null {
  const key = normalizeText(concept)
  if (!key) return null
  let best: Movement | null = null
  for (const movement of movements) {
    if (movement.type !== type || normalizeText(movement.concept) !== key) continue
    if (!best || movement.updatedAt > best.updatedAt) best = movement
  }
  return best?.categoryId ?? null
}
