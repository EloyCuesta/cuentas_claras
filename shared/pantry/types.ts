import type { ISODate } from '../core/types.ts'

/**
 * Despensa. Independiente de las finanzas: no forma parte de FinanceData ni de
 * las copias JSON, y sus estimaciones no crean movimientos ni presupuestos.
 */

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
