import { capitalize, formatDate, shortMonthName } from '../core/dates.ts'
import { sumCents } from '../core/money.ts'
import type { CategoryMonthMatrix, MonthCell, MonthPoint } from './annual.ts'
import { indexCategories, topLevelId } from './categories.ts'
import { effectiveDate, type BreakdownSide, type CategoryBreakdown } from './summary.ts'
import type { Category, Movement } from './types.ts'

/**
 * Exportación a CSV pensada para abrirse en Excel o LibreOffice con
 * configuración española: separador ";", coma decimal y fechas dd/mm/aaaa.
 * En la lista de movimientos los gastos van en negativo para poder sumar la
 * columna de importes; en las plantillas cada tipo tiene sus propias filas.
 */

const SEPARATOR = ';'
const HEADER = [
  'Fecha',
  'Tipo',
  'Concepto',
  'Categoría',
  'Subcategoría',
  'Importe (€)',
  'Estado',
  'Fecha de pago o cobro',
  'Fecha prevista',
  'Recurrente',
  'Notas',
]

/** Número sin separador de miles: -123456 -> "-1234,56". */
function plainAmount(cents: number): string {
  const absolute = Math.abs(cents)
  return `${cents < 0 ? '-' : ''}${Math.floor(absolute / 100)},${String(absolute % 100).padStart(2, '0')}`
}

/**
 * Escapa un campo de texto. Si empieza por =, +, - o @, una hoja de cálculo
 * podría ejecutarlo como fórmula, así que se antepone un apóstrofo.
 */
function textField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[;"\r\n]/.test(safe) || safe !== safe.trim() ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Une filas ya escapadas en un CSV con saltos de línea de Windows. */
function toCsv(rows: readonly string[][]): string {
  return rows.map((row) => row.join(SEPARATOR)).join('\r\n') + '\r\n'
}

function statusLabel(movement: Movement): string {
  if (movement.status === 'pendiente') return 'Pendiente'
  return movement.type === 'gasto' ? 'Pagado' : 'Cobrado'
}

export function movementsToCsv(movements: readonly Movement[], categories: readonly Category[]): string {
  const map = indexCategories(categories)
  const rows = [...movements]
    .sort((a, b) => effectiveDate(a).localeCompare(effectiveDate(b)) || a.createdAt.localeCompare(b.createdAt))
    .map((m) => {
      const category = map.get(m.categoryId)
      const parent = map.get(topLevelId(m.categoryId, map))
      const isChild = Boolean(category?.parentId)
      const signed = m.type === 'gasto' ? -m.amountCents : m.amountCents
      return [
        formatDate(effectiveDate(m)),
        m.type === 'gasto' ? 'Gasto' : 'Ingreso',
        textField(m.concept),
        textField(parent?.name ?? 'Sin categoría'),
        textField(isChild ? (category?.name ?? '') : ''),
        plainAmount(signed),
        statusLabel(m),
        formatDate(m.paidDate),
        formatDate(m.dueDate),
        m.recurringId ? 'Sí' : 'No',
        textField(m.notes),
      ]
    })
  return toCsv([HEADER, ...rows])
}

const optionalAmount = (cents: number | null) => (cents === null ? '' : plainAmount(cents))

/**
 * Plantilla mensual: cada categoría principal con su presupuesto, lo pagado o
 * cobrado, lo pendiente, el total y lo que queda; debajo, sus subcategorías.
 */
export function monthTemplateCsv(breakdown: CategoryBreakdown): string {
  const header = ['Tipo', 'Categoría', 'Subcategoría', 'Presupuesto (€)', 'Pagado o cobrado (€)', 'Pendiente (€)', 'Total (€)', 'Queda (€)']
  const sideRows = (side: BreakdownSide, label: string, totalLabel: string) => [
    ...side.groups.flatMap((group) => [
      [
        label,
        textField(group.name),
        '',
        optionalAmount(group.budgetCents),
        plainAmount(group.paidCents),
        plainAmount(group.pendingCents),
        plainAmount(group.paidCents + group.pendingCents),
        optionalAmount(group.leftCents),
      ],
      ...group.children.map((child) => [
        label,
        textField(group.name),
        textField(child.name),
        '',
        plainAmount(child.paidCents),
        plainAmount(child.pendingCents),
        plainAmount(child.paidCents + child.pendingCents),
        '',
      ]),
    ]),
    [
      label,
      totalLabel,
      '',
      optionalAmount(side.budgetCents),
      plainAmount(side.paidCents),
      plainAmount(side.pendingCents),
      plainAmount(side.paidCents + side.pendingCents),
      optionalAmount(side.leftCents),
    ],
  ]
  const { ingreso, gasto } = breakdown
  const result = [
    '',
    'Resultado',
    '',
    '',
    plainAmount(ingreso.paidCents - gasto.paidCents),
    plainAmount(ingreso.pendingCents - gasto.pendingCents),
    plainAmount(ingreso.paidCents + ingreso.pendingCents - gasto.paidCents - gasto.pendingCents),
    '',
  ]
  return toCsv([header, ...sideRows(ingreso, 'Ingreso', 'Total ingresos'), ...sideRows(gasto, 'Gasto', 'Total gastos'), result])
}

const cellTotal = (cell: MonthCell) => cell.paidCents + cell.pendingCents

/**
 * Plantilla anual: una fila por categoría principal y una columna por mes, con
 * lo pagado o cobrado más lo pendiente. Al final, los totales, el resultado de
 * cada mes, el acumulado y cuánto de todo ello está todavía pendiente.
 */
export function yearTemplateCsv(income: CategoryMonthMatrix, expense: CategoryMonthMatrix, series: readonly MonthPoint[]): string {
  const header = ['Tipo', 'Categoría', ...series.map((p) => capitalize(shortMonthName(p.month))), 'Total']
  const matrixRows = (matrix: CategoryMonthMatrix, label: string, totalLabel: string) => [
    ...matrix.rows.map((row) => [label, textField(row.name), ...row.cells.map((c) => plainAmount(cellTotal(c))), plainAmount(cellTotal(row.total))]),
    [label, totalLabel, ...matrix.totals.map((c) => plainAmount(cellTotal(c))), plainAmount(cellTotal(matrix.total))],
  ]
  const yearForecast = series.at(-1)?.cumulativeForecast ?? 0
  const summaryRow = (label: string, values: number[], total: number) => ['', label, ...values.map(plainAmount), plainAmount(total)]
  const pendingIncome = series.map((p) => p.summary.incomePending)
  const pendingExpense = series.map((p) => p.summary.expensePending)
  return toCsv([
    header,
    ...matrixRows(income, 'Ingreso', 'Total ingresos'),
    ...matrixRows(expense, 'Gasto', 'Total gastos'),
    summaryRow('Resultado', series.map((p) => p.summary.forecast), yearForecast),
    summaryRow('Acumulado', series.map((p) => p.cumulativeForecast), yearForecast),
    summaryRow('De lo anterior, pendiente de cobrar', pendingIncome, sumCents(pendingIncome)),
    summaryRow('De lo anterior, pendiente de pagar', pendingExpense, sumCents(pendingExpense)),
  ])
}
