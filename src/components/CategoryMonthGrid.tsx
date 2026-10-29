import { MONTHS, type CategoryMonthMatrix, type MonthCell } from '../../shared/finance/annual.ts'
import { capitalize, MONTH_NAMES, shortMonthName } from '../../shared/common/dates.ts'
import { formatAmount, formatEuros } from '../../shared/common/money.ts'

/**
 * Una celda del año: lo pagado más lo pendiente. Si incluye algo pendiente va «a
 * lápiz», y el detalle aparece al pasar el ratón. El cero se escribe como una raya.
 */
function GridCell({ cell, current }: { cell: MonthCell; current: boolean }) {
  const total = cell.paidCents + cell.pendingCents
  const classes = ['num', current ? 'is-current' : '', cell.pendingCents > 0 ? 'is-pending' : '', total === 0 ? 'muted' : '']
    .filter(Boolean)
    .join(' ')
  if (total === 0) {
    return (
      <td className={classes}>
        <span aria-hidden="true">–</span>
        <span className="sr-only">0</span>
      </td>
    )
  }
  const detail =
    cell.pendingCents > 0 ? `${formatEuros(cell.paidCents)} real y ${formatEuros(cell.pendingCents)} pendiente` : undefined
  return (
    <td className={classes} title={detail}>
      {formatAmount(total)}
      {detail && <span className="sr-only"> (incluye {formatEuros(cell.pendingCents)} pendiente)</span>}
    </td>
  )
}

function MatrixRows({ matrix, title, currentMonth }: { matrix: CategoryMonthMatrix; title: string; currentMonth: number | null }) {
  return (
    <tbody>
      <tr className="category-table__heading">
        <th scope="colgroup" colSpan={MONTHS.length + 2}>
          <span>{title}</span>
        </th>
      </tr>
      {matrix.rows.map((row) => (
        <tr key={row.categoryId}>
          <th scope="row">{row.name}</th>
          {row.cells.map((cell, index) => (
            <GridCell key={MONTHS[index]} cell={cell} current={MONTHS[index] === currentMonth} />
          ))}
          <GridCell cell={row.total} current={false} />
        </tr>
      ))}
      <tr className="category-table__total">
        <th scope="row">Total {title.toLowerCase()}</th>
        {matrix.totals.map((cell, index) => (
          <GridCell key={MONTHS[index]} cell={cell} current={MONTHS[index] === currentMonth} />
        ))}
        <GridCell cell={matrix.total} current={false} />
      </tr>
    </tbody>
  )
}

/** Ingresos − gastos de una columna, con signo y en rojo si es negativo. */
function ResultCell({ income, expense, current }: { income: MonthCell; expense: MonthCell; current: boolean }) {
  const cents = income.paidCents + income.pendingCents - expense.paidCents - expense.pendingCents
  const classes = ['num', current ? 'is-current' : '', cents < 0 ? 'is-negative' : ''].filter(Boolean).join(' ')
  return <td className={classes}>{cents > 0 ? `+${formatAmount(cents)}` : formatAmount(cents)}</td>
}

/**
 * El año como una hoja de cálculo: una fila por categoría principal, una columna
 * por mes, los totales de ingresos y de gastos y el resultado de cada mes. Es una
 * sola tabla para que los meses de ingresos y gastos queden alineados. La primera
 * columna se queda fija al desplazar la tabla en horizontal.
 */
export function CategoryMonthGrid({
  income,
  expense,
  year,
  currentMonth,
}: {
  income: CategoryMonthMatrix
  expense: CategoryMonthMatrix
  year: number
  /** Mes de hoy si el año es el actual (se resalta su columna). */
  currentMonth: number | null
}) {
  return (
    <div className="table-wrap">
      <table className="table category-table grid-table">
        <caption className="sr-only">Ingresos y gastos de {year} por categoría y mes, en euros</caption>
        <thead>
          <tr>
            <th scope="col">Categoría</th>
            {MONTHS.map((month) => (
              <th key={month} scope="col" className={`num${month === currentMonth ? ' is-current' : ''}`}>
                <abbr title={MONTH_NAMES[month - 1]}>{capitalize(shortMonthName(month))}</abbr>
              </th>
            ))}
            <th scope="col" className="num">
              Total
            </th>
          </tr>
        </thead>
        <MatrixRows matrix={income} title="Ingresos" currentMonth={currentMonth} />
        <MatrixRows matrix={expense} title="Gastos" currentMonth={currentMonth} />
        <tfoot>
          <tr className="category-table__result">
            <th scope="row">Resultado</th>
            {MONTHS.map((month, index) => (
              <ResultCell key={month} income={income.totals[index]} expense={expense.totals[index]} current={month === currentMonth} />
            ))}
            <ResultCell income={income.total} expense={expense.total} current={false} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
