import { formatEuros } from '#shared/common/money.ts'
import type { BreakdownSide, CategoryBreakdown } from '#shared/finance/summary.ts'
import { Total } from '../ui/Amount.tsx'

/** Importe de una celda; el cero se escribe como una raya para que destaque lo que tiene importe. */
function Cell({ cents, pending = false }: { cents: number | null; pending?: boolean }) {
  if (cents === null) return <td className="num" />
  if (cents === 0) {
    return (
      <td className="num muted">
        <span aria-hidden="true">–</span>
        <span className="sr-only">{formatEuros(0)}</span>
      </td>
    )
  }
  return <td className={`num${pending ? ' is-pending' : ''}`}>{formatEuros(cents)}</td>
}

/** Lo que queda de presupuesto; en negativo (y en rojo) si se va a superar. */
function LeftCell({ cents }: { cents: number | null }) {
  if (cents === null) return <td className="num" />
  return <td className={`num${cents < 0 ? ' is-negative' : ''}`}>{formatEuros(cents)}</td>
}

function SideRows({ side, title, totalLabel }: { side: BreakdownSide; title: string; totalLabel: string }) {
  return (
    <tbody>
      <tr className="category-table__heading">
        <th scope="colgroup" colSpan={6}>
          <span>{title}</span>
        </th>
      </tr>
      {side.groups.map((group) => (
        <GroupRows key={group.categoryId} group={group} />
      ))}
      <tr className="category-table__total">
        <th scope="row">{totalLabel}</th>
        <Cell cents={side.budgetCents} />
        <Cell cents={side.paidCents} />
        <Cell cents={side.pendingCents} pending />
        <Cell cents={side.paidCents + side.pendingCents} />
        <LeftCell cents={side.leftCents} />
      </tr>
    </tbody>
  )
}

function GroupRows({ group }: { group: BreakdownSide['groups'][number] }) {
  return (
    <>
      <tr className="category-table__group">
        <th scope="row">{group.name}</th>
        <Cell cents={group.budgetCents} />
        <Cell cents={group.paidCents} />
        <Cell cents={group.pendingCents} pending />
        <Cell cents={group.paidCents + group.pendingCents} />
        <LeftCell cents={group.leftCents} />
      </tr>
      {group.children.map((child) => (
        <tr key={`${group.categoryId}:${child.name}`} className="category-table__child">
          <th scope="row">
            <span className="sr-only">{group.name}, </span>
            {child.name}
          </th>
          <td className="num" />
          <Cell cents={child.paidCents} />
          <Cell cents={child.pendingCents} pending />
          <Cell cents={child.paidCents + child.pendingCents} />
          <td className="num" />
        </tr>
      ))}
    </>
  )
}

/**
 * La plantilla del periodo como una tabla: ingresos y gastos de cada categoría
 * principal (y de sus subcategorías con importes), con su presupuesto, lo real,
 * lo pendiente, el total y lo que queda.
 */
export function CategoryTable({ breakdown, periodName }: { breakdown: CategoryBreakdown; periodName: string }) {
  const { ingreso, gasto } = breakdown
  return (
    <div className="table-wrap">
      <table className="table category-table">
        <caption className="sr-only">Ingresos y gastos por categoría en {periodName}</caption>
        <thead>
          <tr>
            <th scope="col">Categoría</th>
            <th scope="col" className="num">
              Presupuesto
            </th>
            <th scope="col" className="num">
              Real
            </th>
            <th scope="col" className="num">
              Pendiente
            </th>
            <th scope="col" className="num">
              Total
            </th>
            <th scope="col" className="num">
              Queda
            </th>
          </tr>
        </thead>
        <SideRows side={ingreso} title="Ingresos" totalLabel="Total ingresos" />
        <SideRows side={gasto} title="Gastos" totalLabel="Total gastos" />
        <tfoot>
          <tr className="category-table__result">
            <th scope="row">Resultado</th>
            <td className="num" />
            <td className="num">
              <Total cents={ingreso.paidCents - gasto.paidCents} />
            </td>
            <td className="num is-pending">
              <Total cents={ingreso.pendingCents - gasto.pendingCents} />
            </td>
            <td className="num">
              <Total cents={ingreso.paidCents + ingreso.pendingCents - gasto.paidCents - gasto.pendingCents} />
            </td>
            <td className="num" />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
