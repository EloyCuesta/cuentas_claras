import { categoryPath, type CategoryMap } from '#shared/finance/categories.ts'
import { describeDue, MONTH_NAMES } from '#shared/common/dates.ts'
import type { ISODate } from '#shared/common/types.ts'
import type { Movement } from '#shared/finance/types.ts'
import { Amount } from '../ui/Amount.tsx'
import { Icon } from '../ui/Icon.tsx'

/** Hoja de calendario con el día y el mes del vencimiento. */
function DateLeaf({ date }: { date: ISODate }) {
  const day = date.slice(8, 10)
  const month = MONTH_NAMES[Number(date.slice(5, 7)) - 1].slice(0, 3)
  return (
    <span className="leaf" aria-hidden="true">
      <span className="leaf__day">{day}</span>
      <span className="leaf__month">{month}</span>
    </span>
  )
}

/** Botón para confirmar un pago o cobro pendiente. */
export function PayButton({ movement, onPay }: { movement: Movement; onPay: (movement: Movement) => void }) {
  const label = movement.type === 'gasto' ? 'Marcar pagado' : 'Marcar cobrado'
  // El nombre accesible empieza por el texto visible e incluye el concepto.
  return (
    <button type="button" className="btn btn--small btn--pay" onClick={() => onPay(movement)} aria-label={`${label}: ${movement.concept}`}>
      <Icon name="check" size={18} />
      {label}
    </button>
  )
}

/** Lista de vencimientos pendientes con el botón para confirmar el pago. */
export function DueList({
  items,
  today,
  categories,
  onPay,
  onEdit,
}: {
  items: Movement[]
  today: ISODate
  categories: CategoryMap
  onPay: (movement: Movement) => void
  onEdit: (movement: Movement) => void
}) {
  return (
    <ul className="due-list">
      {items.map((movement) => {
        const due = movement.dueDate as ISODate
        const late = due < today
        return (
          <li key={movement.id} className={`due${late ? ' due--late' : ''}`}>
            <DateLeaf date={due} />
            <button type="button" className="due__main" onClick={() => onEdit(movement)}>
              <span className="due__concept">{movement.concept}</span>
              <span className="due__meta">
                <span className={late ? 'due__when due__when--late' : 'due__when'}>
                  {late && <Icon name="alert" size={16} />}
                  {describeDue(due, today)}
                </span>
                <span>{categoryPath(movement.categoryId, categories)}</span>
              </span>
            </button>
            <span className="due__amount">
              <Amount cents={movement.amountCents} type={movement.type} pending />
            </span>
            <span className="due__action">
              <PayButton movement={movement} onPay={onPay} />
            </span>
          </li>
        )
      })}
    </ul>
  )
}
