import { roundRatio } from '#shared/tickets/ticketArithmetic.ts'
import type { SyntheticLine, SyntheticTicket, TaxCode } from './tickets.ts'

/**
 * La verdad de un ticket: lo que tiene que leer la app, línea a línea. Tiene el
 * formato del JSON de un ticket real comprobado a mano (céntimos enteros;
 * `unitPriceCents` solo con multiplicación; los «Desc.» en `discountCents`; la
 * PROMO como ajuste, con la línea bajo la que va), así el banco compara igual
 * los sintéticos y los reales.
 *
 * Las cuentas son las del ticket: peso × precio por kilo redondeado al céntimo
 * y, por grupo de IVA, PVP = importes − descuentos − PROMO, base = PVP / (1 + tipo)
 * redondeada y cuota = PVP − base (así cuadran como en el pie de Lidl).
 */

export interface VerdadLinea {
  rawName: string
  quantity: number
  unitPriceCents: number | null
  amountCents: number
  discountCents: number
  weightKg: number | null
  pricePerKgCents: number | null
  taxCode: TaxCode | null
}

export interface VerdadAjuste {
  label: string
  amountCents: number
  /** Posición (0, 1…) de la línea bajo la que va, si se sabe. */
  line?: number
}

export interface VerdadGrupoIva {
  code: TaxCode
  rate: number
  tax: number
  base: number
  gross: number
}

export interface Verdad {
  provenance?: string
  note?: string
  date: string
  time: string
  totalCents: number
  paymentMethod?: string
  lines: VerdadLinea[]
  adjustments: VerdadAjuste[]
  taxGroups?: VerdadGrupoIva[]
}

export const TAX_RATES: Record<TaxCode, number> = { A: 4, B: 10, C: 21 }

/** Importe de una línea antes de descuentos. */
export function lineAmount(line: SyntheticLine): number {
  if (line.weightKg !== undefined && line.pricePerKgCents !== undefined) return roundRatio(Math.round(line.weightKg * 1000) * line.pricePerKgCents, 1000)
  if (line.cents === undefined) throw new Error(`${line.name}: falta el importe`)
  return line.cents * (line.quantity ?? 1)
}

/** Lo que cuenta una línea para el total: importe menos «Desc.» y PROMO. */
export const lineNet = (line: SyntheticLine) => lineAmount(line) - (line.discountCents ?? 0) - (line.promoCents ?? 0)

export function taxGroupsOf(lines: readonly SyntheticLine[]): VerdadGrupoIva[] {
  const groups: VerdadGrupoIva[] = []
  for (const code of ['A', 'B', 'C'] as const) {
    const own = lines.filter((line) => line.tax === code)
    if (own.length === 0) continue
    const gross = own.reduce((sum, line) => sum + lineNet(line), 0)
    const base = roundRatio(gross * 100, 100 + TAX_RATES[code])
    groups.push({ code, rate: TAX_RATES[code], tax: gross - base, base, gross })
  }
  return groups
}

export function verdadDe(ticket: SyntheticTicket): Verdad {
  return {
    provenance: 'synthetic-image',
    note: `Ticket SINTÉTICO del banco de medida (${ticket.id}): ${ticket.note} Datos inventados con el formato de Lidl Plus; lo dibuja tools/banco-tickets/generar.ts.`,
    date: ticket.date,
    time: ticket.time.slice(0, 5),
    totalCents: ticket.lines.reduce((sum, line) => sum + lineNet(line), 0),
    paymentMethod: 'Lidl Pay',
    lines: ticket.lines.map((line) => ({
      rawName: line.name,
      quantity: line.quantity ?? 1,
      unitPriceCents: line.quantity !== undefined && line.quantity > 1 ? line.cents! : null,
      amountCents: lineAmount(line),
      discountCents: line.discountCents ?? 0,
      weightKg: line.weightKg ?? null,
      pricePerKgCents: line.pricePerKgCents ?? null,
      taxCode: line.tax,
    })),
    adjustments: ticket.lines.flatMap((line, i) => (line.promoCents ? [{ label: 'PROMO LIDL PLUS', amountCents: -line.promoCents, line: i }] : [])),
    taxGroups: taxGroupsOf(ticket.lines),
  }
}
