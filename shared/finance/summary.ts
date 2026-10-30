import { sumCents } from '../core/money.ts'
import { isInPeriod, monthsInPeriod, type Period } from '../core/period.ts'
import type { ISODate } from '../core/types.ts'
import { childrenOf, indexCategories, topLevelCategories, topLevelId, type CategoryMap } from './categories.ts'
import { isProjected } from './recurring.ts'
import type { Category, Movement, MovementType } from './types.ts'

/**
 * Cálculos del resumen de un periodo (un mes o un año). Todo en céntimos enteros.
 *
 * Un movimiento cuenta en el periodo de su fecha de pago/cobro si ya está
 * realizado, o en el de su fecha prevista si sigue pendiente. Los vencimientos
 * proyectados de los recurrentes (ver projectOccurrences) cuentan como pendientes.
 */

export function effectiveDate(movement: Movement): ISODate {
  return (movement.status === 'realizado' ? movement.paidDate : movement.dueDate) ?? ''
}

export function movementsInPeriod(movements: readonly Movement[], period: Period): Movement[] {
  return movements.filter((m) => isInPeriod(effectiveDate(m), period))
}

export interface PeriodSummary {
  /** Real: ya cobrado. */
  incomePaid: number
  /** Real: ya pagado. */
  expensePaid: number
  /** Real: cobrado − pagado. */
  realDifference: number
  /** Previsión: cobros pendientes con fecha prevista en el periodo. */
  incomePending: number
  /** Previsión: pagos pendientes con vencimiento en el periodo. */
  expensePending: number
  pendingIncomeCount: number
  pendingExpenseCount: number
  /** De los cobros pendientes, cuántos son proyecciones de recurrentes. */
  projectedIncomeCount: number
  /** De los pagos pendientes, cuántos son proyecciones de recurrentes. */
  projectedExpenseCount: number
  /** Previsión: (cobrado + por cobrar) − (pagado + por pagar). */
  forecast: number
  movementCount: number
}

export function periodSummary(movements: readonly Movement[], period: Period): PeriodSummary {
  const ofPeriod = movementsInPeriod(movements, period)
  const pick = (type: Movement['type'], status: Movement['status']) =>
    ofPeriod.filter((m) => m.type === type && m.status === status)

  const incomePaid = sumCents(pick('ingreso', 'realizado').map((m) => m.amountCents))
  const expensePaid = sumCents(pick('gasto', 'realizado').map((m) => m.amountCents))
  const pendingIncome = pick('ingreso', 'pendiente')
  const pendingExpense = pick('gasto', 'pendiente')
  const incomePending = sumCents(pendingIncome.map((m) => m.amountCents))
  const expensePending = sumCents(pendingExpense.map((m) => m.amountCents))
  const realDifference = incomePaid - expensePaid

  return {
    incomePaid,
    expensePaid,
    realDifference,
    incomePending,
    expensePending,
    pendingIncomeCount: pendingIncome.length,
    pendingExpenseCount: pendingExpense.length,
    projectedIncomeCount: pendingIncome.filter(isProjected).length,
    projectedExpenseCount: pendingExpense.filter(isProjected).length,
    forecast: realDifference + incomePending - expensePending,
    movementCount: ofPeriod.length,
  }
}

export interface CategoryTotal {
  categoryId: string
  name: string
  paidCents: number
  pendingCents: number
}

/** Suma lo pagado y lo pendiente de cada categoría que devuelve `keyOf`. */
function sumByCategory(
  movements: readonly Movement[],
  map: CategoryMap,
  period: Period,
  type: MovementType,
  keyOf: (categoryId: string) => string,
): Map<string, CategoryTotal> {
  const totals = new Map<string, CategoryTotal>()
  for (const movement of movementsInPeriod(movements, period)) {
    if (movement.type !== type) continue
    const id = keyOf(movement.categoryId)
    const entry = totals.get(id) ?? { categoryId: id, name: map.get(id)?.name ?? 'Sin categoría', paidCents: 0, pendingCents: 0 }
    if (movement.status === 'realizado') entry.paidCents += movement.amountCents
    else entry.pendingCents += movement.amountCents
    totals.set(id, entry)
  }
  return totals
}

/** Ingresos o gastos del periodo agrupados por categoría principal, de mayor a menor. */
export function totalsByCategory(
  movements: readonly Movement[],
  categories: readonly Category[],
  period: Period,
  type: MovementType,
): CategoryTotal[] {
  const map = indexCategories(categories)
  const totals = sumByCategory(movements, map, period, type, (id) => topLevelId(id, map))
  return [...totals.values()].sort(
    (a, b) => b.paidCents + b.pendingCents - (a.paidCents + a.pendingCents) || a.name.localeCompare(b.name, 'es'),
  )
}

/** Gastos del periodo agrupados por categoría principal, de mayor a menor. */
export function expensesByCategory(movements: readonly Movement[], categories: readonly Category[], period: Period): CategoryTotal[] {
  return totalsByCategory(movements, categories, period, 'gasto')
}

export interface BudgetLine {
  category: Category
  /** Presupuesto del periodo: el mensual de la categoría por los meses del periodo. */
  budgetCents: number | null
  spentCents: number
  pendingCents: number
  /** Presupuesto − gastado (negativo si te has pasado). null sin presupuesto. */
  leftCents: number | null
}

/** Consumo de presupuesto de cada categoría principal de gasto en un periodo. */
export function budgetLines(movements: readonly Movement[], categories: readonly Category[], period: Period): BudgetLine[] {
  const totals = new Map(expensesByCategory(movements, categories, period).map((t) => [t.categoryId, t]))
  const months = monthsInPeriod(period)
  return topLevelCategories(categories, 'gasto').map((category) => {
    const total = totals.get(category.id)
    const spentCents = total?.paidCents ?? 0
    const budgetCents = category.budgetCents === null ? null : category.budgetCents * months
    return {
      category,
      budgetCents,
      spentCents,
      pendingCents: total?.pendingCents ?? 0,
      leftCents: budgetCents === null ? null : budgetCents - spentCents,
    }
  })
}

export interface BreakdownGroup extends CategoryTotal {
  /** Presupuesto del periodo (solo categorías principales de gasto). */
  budgetCents: number | null
  /** Presupuesto − (pagado + pendiente): lo que queda si se paga todo lo previsto. */
  leftCents: number | null
  /** Subcategorías con importes en el periodo; vacío si no hay ninguna. */
  children: CategoryTotal[]
}

export interface BreakdownSide {
  groups: BreakdownGroup[]
  paidCents: number
  pendingCents: number
  /** Suma de los presupuestos; null si ninguna categoría tiene. */
  budgetCents: number | null
  /** Lo que queda en las categorías con presupuesto (las demás no cuentan). */
  leftCents: number | null
}

export type CategoryBreakdown = Record<MovementType, BreakdownSide>

/** Nombre de la fila con lo apuntado en una categoría principal que tiene subcategorías. */
export const NO_SUBCATEGORY = 'Sin subcategoría'

/**
 * Desglose del periodo como una plantilla: todas las categorías principales de
 * cada tipo, en su orden, con sus subcategorías debajo (solo las que tienen
 * importes). Si a una principal con subcategorías se le apunta algo directamente,
 * aparece como fila «Sin subcategoría».
 */
export function categoryBreakdown(
  movements: readonly Movement[],
  categories: readonly Category[],
  period: Period,
): CategoryBreakdown {
  const map = indexCategories(categories)
  const months = monthsInPeriod(period)

  const side = (type: MovementType): BreakdownSide => {
    const byCategory = sumByCategory(movements, map, period, type, (id) => id)
    const byParent = sumByCategory(movements, map, period, type, (id) => topLevelId(id, map))
    const parents = topLevelCategories(categories, type)
    // Importes de categorías que ya no existen: van al final, en una fila propia.
    const orphanIds = [...byParent.keys()].filter((id) => !map.has(id))

    const groups: BreakdownGroup[] = [
      ...parents.map((parent) => {
        const total = byParent.get(parent.id)
        const children = childrenOf(categories, parent.id)
          .map((child) => byCategory.get(child.id))
          .filter((line): line is CategoryTotal => line !== undefined)
        const direct = byCategory.get(parent.id)
        if (children.length > 0 && direct) children.push({ ...direct, name: NO_SUBCATEGORY })
        const budgetCents = parent.budgetCents === null ? null : parent.budgetCents * months
        const paidCents = total?.paidCents ?? 0
        const pendingCents = total?.pendingCents ?? 0
        return {
          categoryId: parent.id,
          name: parent.name,
          paidCents,
          pendingCents,
          budgetCents,
          leftCents: budgetCents === null ? null : budgetCents - paidCents - pendingCents,
          children,
        }
      }),
      ...orphanIds.map((id) => ({ ...(byParent.get(id) as CategoryTotal), budgetCents: null, leftCents: null, children: [] })),
    ]
    const budgeted = groups.filter((g) => g.budgetCents !== null)
    return {
      groups,
      paidCents: sumCents(groups.map((g) => g.paidCents)),
      pendingCents: sumCents(groups.map((g) => g.pendingCents)),
      budgetCents: budgeted.length > 0 ? sumCents(budgeted.map((g) => g.budgetCents as number)) : null,
      leftCents: budgeted.length > 0 ? sumCents(budgeted.map((g) => g.leftCents as number)) : null,
    }
  }

  return { ingreso: side('ingreso'), gasto: side('gasto') }
}

/** Movimientos pendientes ordenados por fecha: primero los vencidos. */
export function pendingByDueDate(movements: readonly Movement[], today: ISODate): { overdue: Movement[]; upcoming: Movement[] } {
  const pending = movements
    .filter((m) => m.status === 'pendiente' && m.dueDate)
    .sort((a, b) => (a.dueDate as string).localeCompare(b.dueDate as string) || a.concept.localeCompare(b.concept, 'es'))
  return {
    overdue: pending.filter((m) => (m.dueDate as string) < today),
    upcoming: pending.filter((m) => (m.dueDate as string) >= today),
  }
}
