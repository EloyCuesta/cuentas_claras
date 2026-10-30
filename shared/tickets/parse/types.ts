import type { ISODate } from '../../core/types.ts'
import type { TicketAdjustment, TicketEvidence } from '../types.ts'

/** Tipos del ticket interpretado: líneas, avisos y comprobaciones. */

export type TicketStore = 'lidl' | 'otra'
export type TaxCode = 'A' | 'B' | 'C'

/**
 * - ilegible: no se ha podido leer el importe.
 * - deducido: el importe se ha calculado a partir del total.
 * - corregido: el importe leído no cuadraba y se ha corregido con el total.
 * - dudoso: las lecturas no coinciden y el total no permite decidir.
 */
export type TicketLineFlag = 'ilegible' | 'deducido' | 'corregido' | 'dudoso'

export interface ParsedTicketLine {
  /** Orden en el ticket (0, 1, 2…). */
  position: number
  rawName: string
  /** Clave para emparejar con productos (ver nameKey). */
  key: string
  /** Unidades (las líneas «3,95x 2» tienen 2). */
  quantity: number
  unitPriceCents: number | null
  /** Importe de la línea antes de descuentos. Negativo en una devolución. null si no se ha podido leer. */
  amountCents: number | null
  /** Descuentos aplicados a esta línea (Desc., PROMO LIDL PLUS…), en positivo. */
  discountCents: number
  weightKg: number | null
  pricePerKgCents: number | null
  taxCode: TaxCode | null
  flags: TicketLineFlag[]
  evidence?: TicketEvidence
}

/**
 * Estado de la comprobación del total:
 * - cuadra: la suma coincide y no queda ningún dato dudoso.
 * - pendiente: la suma coincide, pero hay datos dudosos (dos errores pueden compensarse).
 * - no_cuadra: hay una diferencia con el total.
 * - incompleto: faltan importes legibles (o líneas), así que la suma no demuestra nada.
 * - sin_total: no se conoce el total del ticket.
 */
export type TicketCheckStatus = 'cuadra' | 'pendiente' | 'no_cuadra' | 'incompleto' | 'sin_total'

export interface TicketCheck {
  status: TicketCheckStatus
  /** Suma de las líneas con importe (importes menos descuentos) y de los ajustes. */
  linesTotalCents: number
  /** Total del ticket menos esa suma (null sin total). */
  differenceCents: number | null
  /** Líneas y ajustes sin importe. */
  unreadable: number
  /** Líneas con datos dudosos o pendientes de confirmar. */
  pending: number
}

export interface ParsedTicket {
  store: TicketStore
  storeName: string
  address: string
  date: ISODate | null
  /** Hora de la compra (HH:MM). */
  time: string | null
  totalCents: number | null
  lines: ParsedTicketLine[]
  check: TicketCheck
  adjustments: TicketAdjustment[]
  issues: string[]
  /** Desglose de IVA del pie del ticket, si se ha leído y es coherente. */
  taxGroups?: TicketTaxGroup[]
  /** «Lidl Pay», «Tarjeta», «Efectivo»… Nunca guarda números de tarjeta. */
  paymentMethod?: string | null
}

/** Un grupo del desglose de IVA: «B 10% 25,50 2,55» → base 25,50 € + cuota 2,55 € = 28,05 €. */
export interface TicketTaxGroup {
  code: TaxCode
  /** En puntos básicos: 10 % = 1000. */
  rateBasisPoints: number
  baseCents: number
  taxCents: number
  grossCents: number
}

export interface TaxGroupCheck {
  code: TaxCode
  grossCents: number
  /** Suma de los artículos con esa letra (importes menos descuentos); null si alguno no tiene importe. */
  linesCents: number | null
  differenceCents: number | null
}
