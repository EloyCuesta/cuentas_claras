import type { ISODate } from '../core/types.ts'

/** Finanzas: categorías, movimientos y recurrentes. Importes en céntimos enteros y positivos. */

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
