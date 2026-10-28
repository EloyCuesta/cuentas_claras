import type { ReactNode } from 'react'
import { formatEuros } from '../domain/money.ts'
import { formatPeriod, periodUnit, type Period } from '../domain/period.ts'
import type { PeriodSummary } from '../domain/summary.ts'
import { Total } from './Amount.tsx'

function Row({
  op,
  label,
  value,
  total = false,
}: {
  op?: '+' | '−' | '='
  label: ReactNode
  value: ReactNode
  total?: boolean
}) {
  return (
    <div className={`ledger__row${total ? ' ledger__row--total' : ''}`}>
      <dt>
        <span className="ledger__op" aria-hidden="true">
          {op ?? ''}
        </span>
        <span className="ledger__label">{label}</span>
      </dt>
      <dd className="ledger__value">{value}</dd>
    </div>
  )
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** "3 pagos" o "3 pagos, 2 proyectados". */
const pendingCount = (count: number, projected: number, one: string, many: string) =>
  projected > 0 ? `${plural(count, one, many)}, ${plural(projected, 'proyectado', 'proyectados')}` : plural(count, one, many)

/**
 * El resumen del periodo (un mes o un año) escrito como una cuenta en columna.
 * Arriba lo real (lo que ya se ha cobrado y pagado); debajo la previsión, que
 * parte de lo real y suma o resta lo pendiente.
 */
export function Ledger({ summary, period, className = '' }: { summary: PeriodSummary; period: Period; className?: string }) {
  const periodName = formatPeriod(period)
  const hasProjected = summary.projectedIncomeCount + summary.projectedExpenseCount > 0
  return (
    <section className={`sheet ledger ${className}`.trim()} aria-label={`Cuentas de ${periodName}`}>
      <div className="ledger__group">
        <div className="ledger__heading">
          <h2 className="section-title">¿Cuánto he ingresado y gastado?</h2>
          <span className="tag tag--real">Real</span>
        </div>
        <dl className="ledger__rows">
          <Row label="Ingresos cobrados" value={formatEuros(summary.incomePaid)} />
          <Row op="−" label="Gastos pagados" value={formatEuros(summary.expensePaid)} />
          <Row op="=" label="Diferencia" value={<Total cents={summary.realDifference} />} total />
        </dl>
      </div>

      <div className="ledger__group ledger__group--forecast">
        <div className="ledger__heading">
          <h2 className="section-title">¿Cuánto me quedará?</h2>
          <span className="tag tag--forecast">Previsión</span>
        </div>
        <dl className="ledger__rows">
          <Row label="Diferencia real" value={<Total cents={summary.realDifference} />} />
          <Row
            op="+"
            label={
              <>
                Cobros pendientes
                <span className="ledger__count">
                  {pendingCount(summary.pendingIncomeCount, summary.projectedIncomeCount, 'cobro', 'cobros')}
                </span>
              </>
            }
            value={formatEuros(summary.incomePending)}
          />
          <Row
            op="−"
            label={
              <>
                Pagos pendientes del {periodUnit(period)}
                <span className="ledger__count">
                  {pendingCount(summary.pendingExpenseCount, summary.projectedExpenseCount, 'pago', 'pagos')}
                </span>
              </>
            }
            value={formatEuros(summary.expensePending)}
          />
          <Row op="=" label="Resultado previsto" value={<Total cents={summary.forecast} />} total />
        </dl>
        <p className="ledger__note">
          Es lo que entra menos lo que sale en {periodName}, contando lo pendiente. No es el saldo de tu cuenta: la
          aplicación no está conectada al banco.
          {hasProjected &&
            ' Los proyectados son vencimientos futuros de tus recurrentes: se crearán como pendientes cuando se acerque su fecha.'}
        </p>
      </div>
    </section>
  )
}
