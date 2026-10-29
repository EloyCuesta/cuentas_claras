import { createContext, useContext } from 'react'
import type { ISODate } from '#shared/common/types.ts'
import type { Category, FinanceData, Movement, RecurringRule } from '#shared/finance/types.ts'

/** Acciones disponibles para la interfaz. Todas guardan y recargan los datos. */
export interface FinanceActions {
  saveMovement(movement: Movement): Promise<void>
  deleteMovement(id: string): Promise<void>
  saveCategory(category: Category): Promise<void>
  deleteCategory(id: string, replacementId: string | null): Promise<void>
  /** Devuelve cuántos vencimientos se han creado. */
  saveRecurring(rule: RecurringRule, options: { markPastAsPaid: boolean }): Promise<number>
  deleteRecurring(id: string): Promise<void>
  /** Sustituye todos los datos (restaurar copia). */
  replaceAll(data: FinanceData): Promise<void>
  /** Anota la fecha de la última copia descargada. */
  registerBackup(): Promise<void>
}

export interface FinanceContextValue {
  data: FinanceData
  /** Fecha de hoy (se actualiza si la app sigue abierta al cambiar de día). */
  today: ISODate
  lastBackupAt: string | null
  actions: FinanceActions
}

export const FinanceContext = createContext<FinanceContextValue | null>(null)

/** Datos y acciones de la aplicación. Solo se puede usar dentro de <FinanceProvider>. */
export function useFinance(): FinanceContextValue {
  const value = useContext(FinanceContext)
  if (!value) throw new Error('useFinance debe usarse dentro de <FinanceProvider>.')
  return value
}
