/**
 * Tipos del dominio. Son objetos planos (sin clases) para poder guardarlos
 * tal cual en IndexedDB, exportarlos a JSON o enviarlos a un servidor.
 *
 * Reglas generales:
 * - Los importes son SIEMPRE céntimos enteros y positivos (1234 = 12,34 €).
 *   El signo lo da el tipo (ingreso o gasto).
 * - Las fechas de calendario son cadenas ISO "AAAA-MM-DD", sin hora ni zona
 *   horaria, para evitar desfases al cambiar de zona horaria.
 */

/** Fecha de calendario en formato "AAAA-MM-DD". */
export type ISODate = string

export type MovementType = 'ingreso' | 'gasto'

/** "realizado" significa cobrado (ingreso) o pagado (gasto). */
export type MovementStatus = 'pendiente' | 'realizado'

export type Frequency = 'mensual' | 'trimestral' | 'semestral' | 'anual'

export interface Category {
  id: string
  name: string
  type: MovementType
  /** null = categoría principal; si no, id de su categoría principal (un solo nivel). */
  parentId: string | null
  /** Orden de aparición dentro de su grupo. */
  order: number
  /** Presupuesto mensual en céntimos (solo categorías principales de gasto). */
  budgetCents: number | null
}

export interface Movement {
  id: string
  concept: string
  amountCents: number
  type: MovementType
  categoryId: string
  status: MovementStatus
  /** Fecha de cobro o pago. Obligatoria si status = 'realizado'. */
  paidDate: ISODate | null
  /** Fecha prevista o de vencimiento. Obligatoria si status = 'pendiente'. */
  dueDate: ISODate | null
  notes: string
  /** Si lo ha generado un pago recurrente, su id. */
  recurringId: string | null
  /**
   * Fecha programada del vencimiento dentro del recurrente. Junto con
   * recurringId identifica el vencimiento y evita duplicados (índice único).
   * No cambia aunque el usuario edite la fecha prevista.
   */
  occurrenceDate: ISODate | null
  /** Número de cuota (1, 2, 3…) si el recurrente tiene número de cuotas. */
  installmentNumber: number | null
  createdAt: string
  updatedAt: string
}

export interface RecurringRule {
  id: string
  concept: string
  amountCents: number
  type: MovementType
  categoryId: string
  frequency: Frequency
  /** Fecha del primer vencimiento. Su día del mes se repite en los siguientes. */
  startDate: ISODate
  endDate: ISODate | null
  /** Número total de cuotas (préstamos, letras). null = sin límite. */
  installments: number | null
  notes: string
  /** Vencimientos que el usuario ha eliminado y no deben volver a generarse. */
  excludedDates: ISODate[]
  createdAt: string
  updatedAt: string
}

/** Todos los datos de la aplicación. Es lo que se exporta en la copia JSON. */
export interface FinanceData {
  categories: Category[]
  movements: Movement[]
  recurring: RecurringRule[]
}

// ---------------------------------------------------------------------------
// Despensa. Independiente de las finanzas: no forma parte de FinanceData ni de
// las copias JSON, y sus estimaciones no crean movimientos ni presupuestos.

export type PantryUnit = 'ud' | 'g' | 'kg' | 'ml' | 'l' | 'paquete' | 'lata' | 'botella' | 'bolsa' | 'docena'

/** Cada cuánto se compra: casi todas las semanas, una vez al mes o de vez en cuando. */
export type PantryFrequency = 'semanal' | 'mensual' | 'ocasional'

/**
 * Cómo se sigue un producto:
 * - compras: por los tickets y las compras; la app calcula cuándo se estará acabando.
 * - cantidad: contando lo que hay (botones + y −) frente a lo que se quiere tener.
 */
export type PantryTracking = 'compras' | 'cantidad'

/** Una persona de casa. Sus productos no se mezclan con los compartidos. */
export interface PantryPerson {
  id: string
  name: string
  createdAt: string
}

export interface PantryItem {
  id: string
  name: string
  /** null = Compartido; si no, id de una persona. */
  ownerId: string | null
  unit: PantryUnit
  tracking: PantryTracking
  /** Lo que hay ahora (solo cuenta si tracking = 'cantidad'). */
  quantity: number
  /** Lo que se quiere tener. */
  target: number
  frequency: PantryFrequency
  /**
   * Precio estimado en céntimos por una unidad (por kilo en "g" y por litro en
   * "ml"). null = no se conoce; 0 es un precio conocido.
   */
  priceCents: number | null
  notes: string
  /** Aumenta en cada escritura: permite deshacer sin pisar cambios posteriores. */
  version: number
  createdAt: string
  updatedAt: string
}

/** Campos que la interfaz envía al crear o editar un producto (el resto lo pone el servidor). */
export type PantryItemInput = Pick<
  PantryItem,
  'name' | 'ownerId' | 'unit' | 'tracking' | 'quantity' | 'target' | 'frequency' | 'priceCents' | 'notes'
>

export interface PantrySettings {
  /** Presupuesto mensual estimado del hogar en céntimos. null = sin presupuesto. */
  monthlyBudgetCents: number | null
  /** Día del último repaso de la semana. null = todavía no se ha hecho ninguno. */
  lastReviewDate: ISODate | null
}

/**
 * Lo que cambió al marcar productos como comprados: basta para deshacerlo.
 * En los productos que se cuentan, la cantidad anterior; en los que se siguen
 * por compras, la compra apuntada (eventId).
 */
export type PantryPurchaseChange =
  | {
      id: string
      previousQuantity: number
      /** Versión del producto justo después de la compra. */
      version: number
    }
  | { id: string; eventId: string }

/**
 * «Queda», «Queda poco» (a la lista sin que se haya acabado), «Se acabó» o
 * «Lo he comprado» (sin ticket), con su fecha.
 */
export type PantryEventKind = 'queda' | 'poco' | 'se_acabo' | 'comprado'

export interface PantryEvent {
  id: string
  itemId: string
  kind: PantryEventKind
  date: ISODate
  createdAt: string
}

/** Una compra de un producto, sacada de un ticket (o de «Lo he comprado»). */
export interface PantryPurchase {
  itemId: string
  date: ISODate
  /** Cuánto: kilos (measure 'kg') o unidades (measure 'ud'); null si no se sabe. */
  amount: number | null
  measure: 'kg' | 'ud' | null
  /** Lo que costó (ya con descuentos); null si no se sabe. */
  costCents: number | null
  /** Tienda (de un ticket) o null. */
  store: string | null
  ticketId: string | null
  /** Cuándo se apuntó, para ordenar lo que pasó el mismo día. */
  recordedAt: string
}

/** Historial de la despensa: compras (de tickets) y lo que se ha marcado a mano. */
export interface PantryActivity {
  purchases: PantryPurchase[]
  events: PantryEvent[]
}

// ---------------------------------------------------------------------------
// Tickets de la compra

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
