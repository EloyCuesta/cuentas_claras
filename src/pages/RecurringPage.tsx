import { useMemo, useState } from 'react'
import { categoryPath, indexCategories } from '#shared/finance/categories.ts'
import { describeDue, formatDate } from '#shared/common/dates.ts'
import { FREQUENCY_DESCRIPTIONS, generationHorizon, recurringStatus } from '#shared/finance/recurring.ts'
import type { RecurringRule } from '#shared/finance/types.ts'
import { Amount } from '../components/Amount.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { Icon } from '../components/Icon.tsx'
import { RecurringDialog } from '../components/RecurringDialog.tsx'
import { useFinance } from '../state/financeContext.ts'

export function RecurringPage() {
  const { data, today } = useFinance()
  const [editing, setEditing] = useState<{ rule: RecurringRule | null } | null>(null)
  const categories = useMemo(() => indexCategories(data.categories), [data.categories])
  const rules = useMemo(
    () =>
      [...data.recurring]
        .map((rule) => ({ rule, status: recurringStatus(rule, data.movements, today) }))
        .sort(
          (a, b) =>
            Number(a.status.finished) - Number(b.status.finished) ||
            (a.status.nextDate ?? '9999').localeCompare(b.status.nextDate ?? '9999') ||
            a.rule.concept.localeCompare(b.rule.concept, 'es'),
        ),
    [data.recurring, data.movements, today],
  )

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title" tabIndex={-1}>
          Recurrentes
        </h1>
        <button type="button" className="btn btn--primary" onClick={() => setEditing({ rule: null })}>
          <Icon name="plus" />
          Nuevo recurrente
        </button>
      </header>
      <p className="lede">
        Pagos y cobros que se repiten: alquiler, recibos, suscripciones, cuotas de un préstamo o la nómina. Cada vencimiento
        se crea como pendiente hasta el {formatDate(generationHorizon(today))} y cuenta en la previsión hasta que confirmes el
        pago.
      </p>

      {rules.length === 0 ? (
        <EmptyState
          title="Aún no tienes pagos recurrentes"
          actions={
            <button type="button" className="btn btn--primary" onClick={() => setEditing({ rule: null })}>
              <Icon name="plus" />
              Añadir un recurrente
            </button>
          }
        >
          <p>
            Añade el alquiler, los recibos de luz o internet, el seguro del coche o las cuotas de un préstamo. Indica cada
            cuánto se repiten y desde cuándo, y verás sus vencimientos en el resumen.
          </p>
        </EmptyState>
      ) : (
        <ul className="rule-list">
          {rules.map(({ rule, status }) => {
            // "cuotas pagadas" (femenino) o "vencimientos pagados" (masculino); "cobrados" en los ingresos.
            const feminine = rule.installments !== null
            const unit = feminine ? 'cuotas' : 'vencimientos'
            const verb = rule.type === 'gasto' ? 'pagad' : 'cobrad'
            const done = `${verb}${feminine ? 'a' : 'o'}${status.paid === 1 ? '' : 's'}`
            const late = status.nextDate !== null && status.nextDate < today
            return (
              <li key={rule.id} className={`sheet rule${status.finished ? ' rule--finished' : ''}`}>
                <button type="button" className="rule__main" onClick={() => setEditing({ rule })}>
                  <span className="rule__text">
                    <span className="rule__concept">{rule.concept}</span>
                    <span className="rule__meta">
                      <span>{FREQUENCY_DESCRIPTIONS[rule.frequency]}</span>
                      <span>{categoryPath(rule.categoryId, categories)}</span>
                    </span>
                  </span>
                  <Amount cents={status.nextAmountCents ?? rule.amountCents} type={rule.type} />
                </button>
                <div className="rule__status">
                  {status.finished ? (
                    <span className="chip chip--done">
                      <Icon name="check" size={14} />
                      Terminado
                    </span>
                  ) : status.nextDate ? (
                    <span className={late ? 'text-negative' : undefined}>
                      Próximo: {formatDate(status.nextDate)} ({describeDue(status.nextDate, today).toLowerCase()})
                    </span>
                  ) : null}
                  {rule.endDate && !status.finished && <span className="muted">Hasta el {formatDate(rule.endDate)}</span>}
                </div>
                {status.total !== null && status.remaining !== null && (
                  <div className="rule__progress">
                    <div className="meter meter--thin" role="img" aria-label={`${status.paid} de ${status.total} ${unit} ${done}`}>
                      {status.paid > 0 && (
                        <span className="meter__paid" style={{ width: `${Math.min(status.paid / status.total, 1) * 100}%` }} />
                      )}
                    </div>
                    <span>
                      <strong>
                        {status.remaining === 1 ? 'Queda' : 'Quedan'} {status.remaining}{' '}
                        {status.remaining === 1 ? unit.slice(0, -1) : unit}
                      </strong>{' '}
                      de {status.total} ({status.paid} {done})
                    </span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {editing && <RecurringDialog rule={editing.rule} onClose={() => setEditing(null)} />}
    </div>
  )
}
