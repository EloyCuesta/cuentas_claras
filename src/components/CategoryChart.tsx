import { useState } from 'react'
import { formatEuros } from '#shared/common/money.ts'
import type { CategoryTotal } from '#shared/finance/summary.ts'
import { Icon } from './Icon.tsx'

/**
 * Gastos del periodo por categoría como barras horizontales: lo pagado en sólido y
 * lo pendiente en un tono más claro a continuación. Cada barra lleva su importe
 * escrito, y hay una vista de tabla equivalente.
 */
export function CategoryChart({ totals, periodName }: { totals: CategoryTotal[]; periodName: string }) {
  const [asTable, setAsTable] = useState(false)

  if (totals.length === 0) {
    return <p className="muted">No hay gastos en {periodName}. Cuando apuntes alguno, verás aquí en qué se va el dinero.</p>
  }

  const max = Math.max(...totals.map((t) => t.paidCents + t.pendingCents))
  const hasPending = totals.some((t) => t.pendingCents > 0)
  const width = (cents: number) => `${(cents / max) * 100}%`

  return (
    <figure className="chart">
      <figcaption className="sr-only">Gastos por categoría en {periodName}</figcaption>
      <div className="chart__toolbar">
        {hasPending ? (
          <ul className="legend" aria-label="Leyenda">
            <li>
              <span className="legend__swatch legend__swatch--paid" aria-hidden="true" />
              Pagado
            </li>
            <li>
              <span className="legend__swatch legend__swatch--pending" aria-hidden="true" />
              Pendiente
            </li>
          </ul>
        ) : (
          <span className="muted small">Gastos pagados</span>
        )}
        <button type="button" className="btn btn--ghost btn--small" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>
          <Icon name={asTable ? 'bars' : 'table'} size={18} />
          {asTable ? 'Ver gráfico' : 'Ver tabla'}
        </button>
      </div>

      {asTable ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Categoría</th>
                <th scope="col" className="num">
                  Pagado
                </th>
                <th scope="col" className="num">
                  Pendiente
                </th>
                <th scope="col" className="num">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {totals.map((t) => (
                <tr key={t.categoryId}>
                  <th scope="row">{t.name}</th>
                  <td className="num">{formatEuros(t.paidCents)}</td>
                  <td className="num">{formatEuros(t.pendingCents)}</td>
                  <td className="num">{formatEuros(t.paidCents + t.pendingCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="bars">
          {totals.map((t) => (
            <li key={t.categoryId} className="bars__item">
              <div className="bars__head">
                <span className="bars__name">{t.name}</span>
                <span className="bars__value">
                  {formatEuros(t.paidCents)}
                  {t.pendingCents > 0 && <span className="bars__pending">+ {formatEuros(t.pendingCents)} pendiente</span>}
                </span>
              </div>
              <div className="bars__track" aria-hidden="true">
                {t.paidCents > 0 && <span className="bars__seg bars__seg--paid" style={{ width: width(t.paidCents) }} />}
                {t.pendingCents > 0 && <span className="bars__seg bars__seg--pending" style={{ width: width(t.pendingCents) }} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}
