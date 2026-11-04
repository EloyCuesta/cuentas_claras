import { MAX_PANTRY_CENTS } from '#shared/pantry/pantry.ts'
import type { PantryUnit } from '#shared/pantry/types.ts'
import { canApplyLine, roundRatio } from '#shared/tickets/ticketArithmetic.ts'
import type { TicketSaveLine } from '#shared/tickets/types.ts'

/**
 * Lo que deja un ticket guardado en la despensa: el precio y la cantidad de
 * cada producto, la unidad de los nuevos y si cada línea es fiable. Solo las
 * líneas fiables (canApplyLine) cambian precios, cantidades y el ritmo.
 */

const COUNT_UNITS: ReadonlySet<PantryUnit> = new Set(['ud', 'paquete', 'lata', 'botella', 'bolsa', 'docena'])
const paid = (line: Pick<TicketSaveLine, 'amountCents' | 'discountCents'>) => (line.amountCents ?? 0) - line.discountCents

/** Precio por unidad (o por kilo) que deja un ticket para un producto, si la unidad lo permite. */
export function priceFromLines(lines: readonly TicketSaveLine[], unit: PantryUnit): number | null {
  const usable = lines.filter(canApplyLine)
  const last = usable[usable.length - 1]
  if (!last) return null
  let price: number | null = null
  if (last.weightKg !== null && (unit === 'kg' || unit === 'g')) {
    price = roundRatio(paid(last) * 1000, Math.round(last.weightKg * 1000))
  } else if (last.weightKg === null && COUNT_UNITS.has(unit)) {
    price = roundRatio(paid(last), last.quantity)
  }
  return price !== null && price >= 0 && price <= MAX_PANTRY_CENTS ? price : null
}

/** Cuánto se compró en la unidad del producto (para los que se cuentan). */
export function quantityFromLines(lines: readonly TicketSaveLine[], unit: PantryUnit): number | null {
  const bought = lines.filter(canApplyLine)
  if (bought.length === 0) return null
  if (bought.every((line) => line.weightKg !== null)) {
    const grams = bought.reduce((sum, line) => sum + Math.round((line.weightKg as number) * 1000), 0)
    if (unit === 'kg') return grams / 1000
    if (unit === 'g') return grams
    return null
  }
  if (bought.every((line) => line.weightKg === null) && COUNT_UNITS.has(unit)) {
    return bought.reduce((sum, line) => sum + line.quantity, 0)
  }
  return null
}

/** Unidad de un producto nuevo creado desde el ticket: kg si todas sus líneas fiables se pesan; si no, ud. */
export function newItemUnit(usableLines: readonly TicketSaveLine[]): PantryUnit {
  return usableLines.every((line) => line.weightKg !== null) ? 'kg' : 'ud'
}

/**
 * Cómo se guarda una línea: verificada si es fiable (o es una devolución que
 * nadie ha dejado pendiente); si no, pendiente, y no cambia la despensa.
 */
export function lineReviewStatus(line: TicketSaveLine): 'verified' | 'pending' {
  const confirmedReturn = line.amountCents !== null && line.amountCents < 0 && line.reviewStatus !== 'pending'
  return canApplyLine(line) || confirmedReturn ? 'verified' : 'pending'
}
