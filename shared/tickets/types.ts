import type { ISODate } from '../common/types.ts'
import type { PantryFrequency } from '../pantry/types.ts'

/** Tickets de la compra: lo que lee el OCR, la revisión y lo que se guarda. */

/** Una línea leída de la imagen de un ticket. `reread`: su parte final leída otra vez solo con cifras. */
export interface OcrLine {
  text: string
  reread: string | null
  confidence?: number
  words?: { text: string; confidence: number; box: TicketBox }[]
  source?: TicketSource
}

export interface TicketBox { x0: number; y0: number; x1: number; y1: number }
export interface TicketSource {
  imageIndex: number
  segmentIndex: number
  box: TicketBox
  width: number
  height: number
}
export interface TicketSegment {
  image: string
  imageIndex: number
  segmentIndex: number
  offsetY: number
  fullHeight: number
}
export type TicketReadInput = { imagenes: string[] } | { texto: string } | { franjas: TicketSegment[] }
/**
 * Por qué el importe leído no coincide con el calculado (precio × cantidad o
 * peso × precio por kilo), y qué indica cada evidencia.
 * - calculation: un error de lectura en el importe lo explica y en los datos de
 *   la multiplicación no (o una lectura independiente da el calculado).
 * - read: un error en el precio o la cantidad lo explica mejor que uno en el importe.
 * - ambiguous: ninguna evidencia local permite decidir; hace falta una persona.
 */
export interface TicketDiscrepancy {
  kind: 'units' | 'weight'
  verdict: 'calculation' | 'read' | 'ambiguous'
  recognizedCents: number
  calculatedCents: number
  explanation: string
  reasons: string[]
}
/** Importes que la revisión ofrece como botón («Usar 9,90 €»), con su origen. */
export interface TicketAmountOption {
  cents: number
  origin: 'read' | 'reread' | 'calculation'
}
export interface TicketEvidence {
  /** Texto tal cual lo leyó el OCR (nunca se modifica). */
  text: string
  reread: string | null
  /** El texto tras normalizar cifras y separadores, para comparar. */
  normalized?: string
  recognizedCents: number | null
  calculatedCents: number | null
  selectedBy: 'read' | 'reread' | 'calculation' | 'manual'
  issues: string[]
  discrepancy?: TicketDiscrepancy
  options?: TicketAmountOption[]
  source?: TicketSource
}
export interface TicketAdjustment {
  id: string
  label: string
  kind: 'discount' | 'coupon' | 'promotion' | 'other'
  /** Signed amount: discounts subtract. null is unknown, never zero. */
  amountCents: number | null
  needsReview: boolean
  originalText?: string
}

export type TicketStoreKind = 'lidl' | 'otra'
export type TicketTaxCode = 'A' | 'B' | 'C'

/** Un ticket guardado (sin sus líneas). */
export interface PantryTicketSummary {
  id: string
  store: TicketStoreKind
  storeName: string
  address: string
  date: ISODate
  time: string | null
  totalCents: number | null
  linesCount: number
  /** Productos distintos de la despensa que aparecen en el ticket. */
  productsCount: number
  createdAt: string
}

export interface PantryTicketLine {
  id: string
  position: number
  rawName: string
  quantity: number
  unitPriceCents: number | null
  amountCents: number | null
  discountCents: number
  weightKg: number | null
  pricePerKgCents: number | null
  taxCode: TicketTaxCode | null
  /** Producto de la despensa; null si la línea no se sigue. */
  itemId: string | null
  /** «Para una ocasión»: no cuenta para el ritmo de compra. */
  occasional: boolean
  reviewStatus?: 'verified' | 'pending'
  confirmed?: boolean
  evidence?: TicketEvidence
}

export interface PantryTicket extends PantryTicketSummary {
  lines: PantryTicketLine[]
  adjustments?: TicketAdjustment[]
  issues?: string[]
}

/** Qué hacer con un producto del ticket al guardarlo. */
export type TicketDecision =
  | { kind: 'item'; itemId: string }
  | { kind: 'new'; name: string; ownerId: string | null; frequency: PantryFrequency }
  | { kind: 'ignore' }

export type TicketSaveLine = Omit<PantryTicketLine, 'id' | 'position' | 'itemId'>

/** Lo que envía la revisión al guardar: cabecera, líneas y una decisión por producto (clave nameKey del nombre). */
export interface TicketSaveInput {
  store: TicketStoreKind
  storeName: string
  address: string
  date: ISODate
  time: string | null
  totalCents: number | null
  lines: TicketSaveLine[]
  decisions: Record<string, TicketDecision>
  adjustments?: TicketAdjustment[]
  issues?: string[]
  acknowledged?: boolean
  importId?: string
  sourceFingerprint?: string
  distinctPurchase?: boolean
}
