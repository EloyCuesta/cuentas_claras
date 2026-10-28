import { formatEuros } from '../domain/money.ts'
import type { BudgetLine } from '../domain/summary.ts'
import { Icon } from './Icon.tsx'

/**
 * Barra de consumo de un presupuesto: lo pagado en sólido y lo pendiente en
 * claro sobre una pista del mismo tono. Si se supera, la barra se vuelve roja y
 * el texto lo dice (el color nunca va solo).
 */
export function BudgetMeter({ line, unit = 'mes' }: { line: BudgetLine; unit?: 'mes' | 'año' }) {
  const budget = line.budgetCents ?? 0
  const over = line.leftCents !== null && line.leftCents < 0
  const paidShare = budget > 0 ? Math.min(line.spentCents / budget, 1) : 0
  const pendingShare = budget > 0 ? Math.min(line.pendingCents / budget, 1 - paidShare) : 0
  const percent = budget > 0 ? Math.round((line.spentCents / budget) * 100) : 0

  return (
    <div className="budget">
      <div className="budget__numbers">
        <span>
          <strong>{formatEuros(line.spentCents)}</strong> de {formatEuros(budget)}
          <span className="muted"> ({percent} %)</span>
        </span>
        {over ? (
          <span className="budget__status budget__status--over">
            <Icon name="alert" size={16} />
            Te has pasado {formatEuros(-(line.leftCents as number))}
          </span>
        ) : (
          <span className="budget__status">Quedan {formatEuros(line.leftCents ?? 0)}</span>
        )}
      </div>
      <div
        className={`meter${over ? ' meter--over' : ''}`}
        role="img"
        aria-label={`Gastado el ${percent} % del presupuesto`}
      >
        {paidShare > 0 && <span className="meter__paid" style={{ width: `${paidShare * 100}%` }} />}
        {pendingShare > 0 && <span className="meter__pending" style={{ width: `${pendingShare * 100}%` }} />}
      </div>
      {line.pendingCents > 0 && (
        <p className="budget__pending">Además hay {formatEuros(line.pendingCents)} pendientes de pagar este {unit}.</p>
      )}
    </div>
  )
}
