import { MAX_PANTRY_CENTS } from './pantry.ts'
import { canApplyLine, roundRatio } from './ticketArithmetic.ts'
import { nameKey } from './ticketText.ts'
import type { PantryItem, PantryItemInput, PantryUnit, TicketSaveInput, TicketSaveLine } from './types.ts'

/**
 * Qué cambia en la despensa al guardar un ticket revisado, calculado sin tocar
 * la base de datos. El repositorio solo tiene que aplicar este plan dentro de
 * una transacción.
 *
 * Reglas:
 * - Las líneas se agrupan por su nombre normalizado (nameKey) y cada grupo
 *   sigue la decisión de la revisión: un producto que ya existe, uno nuevo o
 *   «no seguir».
 * - Solo las líneas fiables (canApplyLine) cambian precios y cantidades, crean
 *   productos o enseñan equivalencias. Las demás se guardan en el ticket.
 * - Dos grupos con el mismo producto nuevo (mismo nombre y persona) crean un
 *   solo producto.
 */

/** A qué producto va cada grupo de líneas. `newRef` apunta a un producto que todavía no existe. */
export type LineTarget = { kind: 'none' } | { kind: 'existing'; itemId: string } | { kind: 'new'; newRef: string }

export interface NewItemPlan {
  newRef: string
  input: PantryItemInput
}

export interface ItemUpdatePlan {
  itemId: string
  /** Precio por unidad o por kilo que deja el ticket; null = no cambia. */
  priceCents: number | null
  /** Lo comprado en la unidad del producto (solo cuenta en los que se cuentan); null = no se sabe. */
  addQuantity: number | null
}

export interface AliasPlan {
  key: string
  target: LineTarget
}

export interface PlannedLine {
  line: TicketSaveLine
  key: string
  target: LineTarget
  reviewStatus: 'verified' | 'pending'
}

export interface TicketSavePlan {
  newItems: NewItemPlan[]
  updates: ItemUpdatePlan[]
  aliases: AliasPlan[]
  lines: PlannedLine[]
}

export type PlanResult = { ok: true; plan: TicketSavePlan } | { ok: false; error: string }

const NONE: LineTarget = { kind: 'none' }
const COUNT_UNITS: ReadonlySet<PantryUnit> = new Set(['ud', 'paquete', 'lata', 'botella', 'bolsa', 'docena'])

const paid = (line: Pick<TicketSaveLine, 'amountCents' | 'discountCents'>) => (line.amountCents ?? 0) - line.discountCents
const grams = (weightKg: number) => Math.round(weightKg * 1000)

/** Precio por unidad (o por kilo) que deja la última línea fiable, si la unidad lo permite. */
export function priceFromLines(lines: readonly TicketSaveLine[], unit: PantryUnit): number | null {
  const usable = lines.filter(canApplyLine)
  const last = usable[usable.length - 1]
  if (!last) return null
  let price: number | null = null
  if (last.weightKg !== null && (unit === 'kg' || unit === 'g')) {
    price = roundRatio(paid(last) * 1000, grams(last.weightKg))
  } else if (last.weightKg === null && COUNT_UNITS.has(unit)) {
    price = roundRatio(paid(last), last.quantity)
  }
  return price !== null && price >= 0 && price <= MAX_PANTRY_CENTS ? price : null
}

/** Cuánto se compró en la unidad del producto. null si no se puede expresar en esa unidad. */
export function quantityFromLines(lines: readonly TicketSaveLine[], unit: PantryUnit): number | null {
  const bought = lines.filter(canApplyLine)
  if (bought.length === 0) return null
  if (bought.every((line) => line.weightKg !== null)) {
    const total = bought.reduce((sum, line) => sum + grams(line.weightKg as number), 0)
    if (unit === 'kg') return total / 1000
    if (unit === 'g') return total
    return null
  }
  if (bought.every((line) => line.weightKg === null) && COUNT_UNITS.has(unit)) return bought.reduce((sum, line) => sum + line.quantity, 0)
  return null
}

/** Una línea queda «verificada» si es fiable, o si es una devolución que no está pendiente. */
function reviewStatusOf(line: TicketSaveLine): 'verified' | 'pending' {
  if (canApplyLine(line)) return 'verified'
  return line.amountCents !== null && line.amountCents < 0 && line.reviewStatus !== 'pending' ? 'verified' : 'pending'
}

function groupByKey(lines: readonly TicketSaveLine[]): Map<string, TicketSaveLine[]> {
  const groups = new Map<string, TicketSaveLine[]>()
  for (const line of lines) {
    const key = nameKey(line.rawName)
    groups.set(key, [...(groups.get(key) ?? []), line])
  }
  return groups
}

/**
 * Calcula el plan. `items` son los productos que existen ahora (para
 * comprobar las decisiones y saber la unidad de cada uno).
 */
export function planTicketSave(input: TicketSaveInput, items: readonly PantryItem[]): PlanResult {
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const groups = groupByKey(input.lines)
  const targets = new Map<string, LineTarget>()
  // Producto nuevo de cada referencia (nombre + persona) y todas sus líneas fiables.
  const newByRef = new Map<string, { decision: Extract<TicketSaveInput['decisions'][string], { kind: 'new' }>; lines: TicketSaveLine[] }>()

  for (const [key, lines] of groups) {
    const decision = input.decisions[key]
    if (!decision) return { ok: false, error: `Falta qué hacer con «${lines[0].rawName}».` }
    if (decision.kind === 'ignore') {
      targets.set(key, NONE)
    } else if (decision.kind === 'item') {
      if (!itemsById.has(decision.itemId)) {
        return { ok: false, error: `«${lines[0].rawName}» está asociado a un producto que ya no existe. Elige otro.` }
      }
      targets.set(key, { kind: 'existing', itemId: decision.itemId })
    } else {
      const usable = lines.filter(canApplyLine)
      // Sin ninguna línea fiable no se crea nada.
      if (usable.length === 0) {
        targets.set(key, NONE)
        continue
      }
      const newRef = `${nameKey(decision.name)}|${decision.ownerId ?? ''}`
      const entry = newByRef.get(newRef) ?? { decision, lines: [] }
      entry.lines.push(...usable)
      newByRef.set(newRef, entry)
      targets.set(key, { kind: 'new', newRef })
    }
  }

  const newItems: NewItemPlan[] = [...newByRef].map(([newRef, { decision, lines }]) => {
    const unit: PantryUnit = lines.every((line) => line.weightKg !== null) ? 'kg' : 'ud'
    return {
      newRef,
      input: {
        name: decision.name,
        ownerId: decision.ownerId,
        unit,
        tracking: 'compras',
        quantity: 0,
        target: 0,
        frequency: decision.frequency,
        priceCents: priceFromLines(lines, unit),
        notes: '',
      },
    }
  })

  // Lo aprendido: solo de los grupos con alguna línea fiable.
  const aliases: AliasPlan[] = []
  for (const [key, lines] of groups) {
    if (lines.some(canApplyLine)) aliases.push({ key, target: targets.get(key) ?? NONE })
  }

  // Lo que cambia en los productos que ya existían (los nuevos ya nacen con su precio).
  const linesOfItem = new Map<string, TicketSaveLine[]>()
  for (const [key, target] of targets) {
    if (target.kind !== 'existing') continue
    const usable = (groups.get(key) ?? []).filter(canApplyLine)
    linesOfItem.set(target.itemId, [...(linesOfItem.get(target.itemId) ?? []), ...usable])
  }
  const updates: ItemUpdatePlan[] = []
  for (const [itemId, lines] of linesOfItem) {
    if (lines.length === 0) continue
    const { unit } = itemsById.get(itemId) as PantryItem
    updates.push({ itemId, priceCents: priceFromLines(lines, unit), addQuantity: quantityFromLines(lines, unit) })
  }

  const lines: PlannedLine[] = input.lines.map((line) => {
    const key = nameKey(line.rawName)
    return { line, key, target: targets.get(key) ?? NONE, reviewStatus: reviewStatusOf(line) }
  })

  return { ok: true, plan: { newItems, updates, aliases, lines } }
}
