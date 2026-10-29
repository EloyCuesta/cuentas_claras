import type { ParsedTicket, ParsedTicketLine } from './ticketParse.ts'
import { guessFrequency, nameKey, prettyName, similarity } from './ticketText.ts'
import type { PantryFrequency, PantryItem, PantryTicketSummary } from './types.ts'

/**
 * Qué hacer con cada producto de un ticket. La app aprende: al guardar un
 * ticket recuerda, para esa tienda, que «LECHE SEMI HACEND 1L» es la Leche (o
 * que esa línea no se sigue), y el siguiente ticket ya llega emparejado.
 */

/** Equivalencia guardada: línea de ticket (clave) → producto, o null si no se sigue. */
export interface AliasRecord {
  key: string
  itemId: string | null
}

export type TicketSuggestion =
  /** recordado: ya se emparejó en otro ticket; parecido: casi igual a uno recordado (error del OCR); nombre: se parece al nombre del producto. */
  | { kind: 'item'; itemId: string; how: 'recordado' | 'parecido' | 'nombre' }
  | { kind: 'ignore'; how: 'recordado' }
  | { kind: 'new'; name: string; frequency: PantryFrequency }

/** Lo que devuelve la lectura de un ticket: nada se guarda hasta que el usuario lo revisa. */
export interface TicketDraft {
  ticket: ParsedTicket
  /** Qué hacer con cada producto (por su clave), según lo aprendido. */
  suggestions: Record<string, TicketSuggestion>
  /** Si ya hay un ticket igual guardado. */
  duplicate: PantryTicketSummary | null
}

const ALIAS_SIMILARITY = 0.85
const NAME_SIMILARITY = 0.8
const SAME_TICKET_SIMILARITY = 0.85

/** El destino (producto) más parecido y cuánto le saca al segundo. */
function bestMatch<T>(key: string, options: readonly T[], keyOf: (option: T) => string, targetOf: (option: T) => string | null) {
  const perTarget = new Map<string, { option: T; score: number }>()
  for (const option of options) {
    const target = targetOf(option)
    if (target === null) continue
    const score = similarity(key, keyOf(option))
    const current = perTarget.get(target)
    if (!current || score > current.score) perTarget.set(target, { option, score })
  }
  const ranked = [...perTarget.values()].sort((a, b) => b.score - a.score)
  if (ranked.length === 0) return null
  return { ...ranked[0], margin: ranked[0].score - (ranked[1]?.score ?? 0) }
}

/**
 * Una sugerencia por cada clave distinta del ticket. Las variantes del mismo
 * producto dentro del ticket («FTLETE DE PECHUGA» y «FILETE DE PECHUGA») se
 * proponen como un único producto nuevo.
 */
export function suggestForTicket(
  lines: readonly Pick<ParsedTicketLine, 'key' | 'rawName'>[],
  aliases: readonly AliasRecord[],
  items: readonly Pick<PantryItem, 'id' | 'name'>[],
): Map<string, TicketSuggestion> {
  const existing = new Set(items.map((item) => item.id))
  const known = aliases.filter((alias) => alias.itemId === null || existing.has(alias.itemId))
  const byKey = new Map(known.map((alias) => [alias.key, alias]))

  // Claves en orden de aparición, con cuántas veces aparecen y su primer nombre.
  const keys: { key: string; rawName: string; count: number }[] = []
  for (const line of lines) {
    const entry = keys.find((k) => k.key === line.key)
    if (entry) entry.count++
    else keys.push({ key: line.key, rawName: line.rawName, count: 1 })
  }

  const result = new Map<string, TicketSuggestion>()
  const unmatched: typeof keys = []
  for (const entry of keys) {
    const exact = byKey.get(entry.key)
    if (exact) {
      result.set(entry.key, exact.itemId === null ? { kind: 'ignore', how: 'recordado' } : { kind: 'item', itemId: exact.itemId, how: 'recordado' })
      continue
    }
    const alias = bestMatch(entry.key, known.filter((a) => a.itemId !== null), (a) => a.key, (a) => a.itemId)
    if (alias && alias.score >= ALIAS_SIMILARITY && alias.margin >= 0.05 && alias.option.itemId) {
      result.set(entry.key, { kind: 'item', itemId: alias.option.itemId, how: 'parecido' })
      continue
    }
    const item = bestMatch(entry.key, items, (i) => nameKey(i.name), (i) => i.id)
    if (item && item.score >= NAME_SIMILARITY && item.margin >= 0.05) {
      result.set(entry.key, { kind: 'item', itemId: item.option.id, how: 'nombre' })
      continue
    }
    unmatched.push(entry)
  }

  // Productos nuevos: las variantes parecidas del mismo ticket usan el nombre de la más repetida.
  const groups: (typeof keys)[] = []
  for (const entry of unmatched) {
    const group = groups.find((g) => similarity(g[0].key, entry.key) >= SAME_TICKET_SIMILARITY)
    if (group) group.push(entry)
    else groups.push([entry])
  }
  for (const group of groups) {
    const main = [...group].sort((a, b) => b.count - a.count)[0]
    const suggestion: TicketSuggestion = { kind: 'new', name: prettyName(main.rawName), frequency: guessFrequency(main.rawName) }
    for (const entry of group) result.set(entry.key, suggestion)
  }
  return result
}
