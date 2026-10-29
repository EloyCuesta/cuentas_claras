import { categoryPath, type CategoryMap } from '../../shared/finance/categories.ts'
import { capitalize, formatDate, formatMonthYear } from '../../shared/common/dates.ts'
import { effectiveDate } from '../../shared/finance/summary.ts'
import type { ISODate } from '../../shared/common/types.ts'
import type { Movement, RecurringRule } from '../../shared/finance/types.ts'
import { Amount } from './Amount.tsx'
import { PayButton } from './DueList.tsx'
import { Icon } from './Icon.tsx'

function statusText(movement: Movement, today: ISODate): { text: string; late: boolean } {
  if (movement.status === 'realizado') {
    return { text: `${movement.type === 'gasto' ? 'Pagado' : 'Cobrado'} el ${formatDate(movement.paidDate)}`, late: false }
  }
  const due = movement.dueDate as ISODate
  return due < today
    ? { text: `Venció el ${formatDate(due)}`, late: true }
    : { text: `Vence el ${formatDate(due)}`, late: false }
}

function MovementItem({
  movement,
  today,
  categories,
  rule,
  onEdit,
  onPay,
}: {
  movement: Movement
  today: ISODate
  categories: CategoryMap
  rule: RecurringRule | undefined
  onEdit: (movement: Movement) => void
  onPay: (movement: Movement) => void
}) {
  const pending = movement.status === 'pendiente'
  const status = statusText(movement, today)
  const installment =
    movement.installmentNumber && rule?.installments ? `Cuota ${movement.installmentNumber} de ${rule.installments}` : 'Recurrente'

  return (
    <li className={`move${pending ? ' move--pending' : ''}`}>
      <button type="button" className="move__main" onClick={() => onEdit(movement)}>
        <span className="move__text">
          <span className="move__concept">{movement.concept}</span>
          <span className="move__meta">
            {pending && <span className={`chip${status.late ? ' chip--late' : ''}`}>{status.late ? 'Vencido' : 'Pendiente'}</span>}
            <span className={status.late ? 'text-negative' : undefined}>{status.text}</span>
            <span>{categoryPath(movement.categoryId, categories)}</span>
            {movement.recurringId && (
              <span className="move__tag">
                <Icon name="repeat" size={14} />
                {installment}
              </span>
            )}
          </span>
        </span>
        <Amount cents={movement.amountCents} type={movement.type} pending={pending} />
      </button>
      {pending && (
        <div className="move__actions">
          <PayButton movement={movement} onPay={onPay} />
        </div>
      )}
    </li>
  )
}

/** Movimientos agrupados por mes (de la fecha de pago o la prevista). */
export function MovementList({
  movements,
  today,
  categories,
  rules,
  onEdit,
  onPay,
}: {
  movements: Movement[]
  today: ISODate
  categories: CategoryMap
  rules: ReadonlyMap<string, RecurringRule>
  onEdit: (movement: Movement) => void
  onPay: (movement: Movement) => void
}) {
  const groups: { key: string; title: string; items: Movement[] }[] = []
  for (const movement of movements) {
    const key = effectiveDate(movement).slice(0, 7)
    let group = groups.at(-1)
    if (!group || group.key !== key) {
      group = { key, title: capitalize(formatMonthYear(Number(key.slice(0, 4)), Number(key.slice(5, 7)))), items: [] }
      groups.push(group)
    }
    group.items.push(movement)
  }

  return (
    <div className="move-groups">
      {groups.map((group) => (
        <section key={group.key} className="move-group" aria-label={group.title}>
          <h2 className="move-group__title">{group.title}</h2>
          <ul className="move-list">
            {group.items.map((movement) => (
              <MovementItem
                key={movement.id}
                movement={movement}
                today={today}
                categories={categories}
                rule={movement.recurringId ? rules.get(movement.recurringId) : undefined}
                onEdit={onEdit}
                onPay={onPay}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
