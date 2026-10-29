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
  /** Lo que hay ahora. */
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
export type PantryItemInput = Pick<PantryItem, 'name' | 'ownerId' | 'unit' | 'quantity' | 'target' | 'frequency' | 'priceCents' | 'notes'>

export interface PantrySettings {
  /** Presupuesto mensual estimado del hogar en céntimos. null = sin presupuesto. */
  monthlyBudgetCents: number | null
}

/** Lo que cambió al marcar productos como comprados: basta para deshacerlo. */
export interface PantryPurchaseChange {
  id: string
  previousQuantity: number
  /** Versión del producto justo después de la compra. */
  version: number
}
