import { formatEuros } from '../../shared/core/money.ts'
import type { BudgetLine } from '../../shared/finance/summary.ts'
import { Icon } from './Icon.tsx'

type MeterLine = Pick<BudgetLine, 'budgetCents' | 'spentCents' | 'pendingCents' | 'leftCents'>

/**
 * Barra de consumo de un presupuesto: lo pagado en sólido y lo pendiente en
 * claro sobre una pista del mismo tono. Si se supera, la barra se vuelve roja y
 * el texto lo dice (el color nunca va solo).
 *
 * kind="estimate" (despensa): el importe es una estimación, no un gasto. Los
 * textos hablan de «estimado» y nunca de «gastado» o «pagado».
 */
export function BudgetMeter({
  line,
  unit = 'mes',
  kind = 'spent',
}: {
  line: MeterLine
  unit?: 'mes' | 'año'
  kind?: 'spent' | 'estimate'
}) {
  const budget = line.budgetCents ?? 0
  const over = line.leftCents !== null && line.leftCents < 0
  const estimate = kind === 'estimate'
  // Con presupuesto 0 no hay porcentaje posible: si hay algo, la barra entera indica que se supera.
  const paidShare = budget > 0 ? Math.min(line.spentCents / budget, 1) : estimate && over ? 1 : 0
  const pendingShare = budget > 0 ? Math.min(line.pendingCents / budget, 1 - paidShare) : 0
  const percent = budget > 0 ? Math.round((line.spentCents / budget) * 100) : estimate ? null : 0

  const label = estimate
    ? percent === null
      ? `Estimación de ${formatEuros(line.spentCents)} con un presupuesto de ${formatEuros(budget)}`
      : `Estimación: el ${percent} % del presupuesto`
    : `Gastado el ${percent} % del presupuesto`

  return (
    <div className="budget">
      <div className="budget__numbers">
        <span>
          <strong>{formatEuros(line.spentCents)}</strong>
          {estimate ? ' estimados' : ''} de {formatEuros(budget)}
          {percent !== null && <span className="muted"> ({percent} %)</span>}
        </span>
        {over ? (
          <span className="budget__status budget__status--over">
            <Icon name="alert" size={16} />
            {estimate ? 'La estimación supera el presupuesto en ' : 'Te has pasado '}
            {formatEuros(-(line.leftCents as number))}
          </span>
        ) : (
          <span className="budget__status">
            {estimate ? 'Margen estimado: ' : 'Quedan '}
            {formatEuros(line.leftCents ?? 0)}
          </span>
        )}
      </div>
      <div className={`meter${over ? ' meter--over' : ''}`} role="img" aria-label={label}>
        {paidShare > 0 && <span className="meter__paid" style={{ width: `${paidShare * 100}%` }} />}
        {pendingShare > 0 && <span className="meter__pending" style={{ width: `${pendingShare * 100}%` }} />}
      </div>
      {line.pendingCents > 0 && (
        <p className="budget__pending">Además hay {formatEuros(line.pendingCents)} pendientes de pagar este {unit}.</p>
      )}
    </div>
  )
}
