import type { ISODate } from '#shared/common/types.ts'
import type { PantryPurchase } from '#shared/pantry/types.ts'

/**
 * Del historial de tickets a las compras de cada producto, para el ritmo de
 * compra (cuánto suele durar cada cosa).
 */

/** Una línea de ticket que cuenta para el ritmo: con producto, verificada y no «para una ocasión». */
export interface PurchaseLine {
  ticketId: string
  itemId: string
  quantity: number
  amountCents: number | null
  discountCents: number
  weightKg: number | null
  /** Fecha del ticket. */
  date: ISODate
  /** Nombre de la tienda. */
  store: string
  /** Cuándo se guardó el ticket, para ordenar lo que pasó el mismo día. */
  recordedAt: string
}

/**
 * Una compra por producto y ticket (las líneas repetidas se suman), sin las
 * devoluciones. Cuánto: kilos si todas sus líneas se pesan, unidades si
 * ninguna, y si no, no se sabe. Lo que costó, con los descuentos, si se sabe
 * el importe de todas.
 */
export function purchasesFromLines(lines: readonly PurchaseLine[]): PantryPurchase[] {
  const grouped = new Map<string, PurchaseLine[]>()
  for (const line of lines) {
    if (line.amountCents !== null && line.amountCents < 0) continue
    const key = `${line.ticketId}|${line.itemId}`
    grouped.set(key, [...(grouped.get(key) ?? []), line])
  }
  return [...grouped.values()].map((rows) => {
    const first = rows[0]
    const weighted = rows.every((row) => row.weightKg !== null)
    const counted = rows.every((row) => row.weightKg === null)
    const amount = weighted
      ? Math.round(rows.reduce((sum, row) => sum + (row.weightKg as number), 0) * 1000) / 1000
      : counted
        ? rows.reduce((sum, row) => sum + row.quantity, 0)
        : null
    const costCents = rows.some((row) => row.amountCents === null)
      ? null
      : rows.reduce((sum, row) => sum + (row.amountCents as number) - row.discountCents, 0)
    return {
      itemId: first.itemId,
      date: first.date,
      amount,
      measure: weighted ? 'kg' : counted ? 'ud' : null,
      costCents,
      store: first.store,
      ticketId: first.ticketId,
      recordedAt: first.recordedAt,
    }
  })
}
