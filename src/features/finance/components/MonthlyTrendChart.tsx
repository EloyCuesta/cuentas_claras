import { useRef, useState, type KeyboardEvent } from 'react'
import type { MonthPoint } from '#shared/finance/annual.ts'
import { capitalize, MONTH_NAMES, shortMonthName } from '#shared/common/dates.ts'
import { formatCompactEuros, formatEuros } from '#shared/common/money.ts'
import { Total } from '../../../ui/Amount.tsx'
import { Icon } from '../../../ui/Icon.tsx'

/** Paso "redondo" del eje (1, 2, 2,5 o 5 por una potencia de 10) para unas cuatro divisiones. */
function niceStep(maxCents: number): number {
  const raw = maxCents / 4
  const power = 10 ** Math.floor(Math.log10(raw))
  const fraction = raw / power
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return nice * power
}

function axisTicks(maxCents: number): number[] {
  const step = niceStep(Math.max(maxCents, 100))
  const count = Math.max(1, Math.ceil(maxCents / step))
  return Array.from({ length: count + 1 }, (_, i) => Math.round(i * step))
}

const monthName = (month: number) => capitalize(MONTH_NAMES[month - 1])

/** Texto completo de un mes, para el lector de pantalla y la lectura bajo el gráfico. */
function describeMonth(point: MonthPoint): string {
  const s = point.summary
  const pending = (cents: number) => (cents > 0 ? ` (${formatEuros(cents)} pendiente)` : '')
  return (
    `${monthName(point.month)}: ingresos ${formatEuros(s.incomePaid + s.incomePending)}${pending(s.incomePending)}, ` +
    `gastos ${formatEuros(s.expensePaid + s.expensePending)}${pending(s.expensePending)}, ` +
    `resultado previsto ${formatEuros(s.forecast, 'always')}.`
  )
}

function Column({ paid, pending, top, kind }: { paid: number; pending: number; top: number; kind: 'income' | 'expense' }) {
  const total = paid + pending
  if (total === 0) return <span className={`trend__col trend__col--${kind}`} />
  return (
    <span className={`trend__col trend__col--${kind}`} style={{ height: `${(total / top) * 100}%` }}>
      {pending > 0 && <span className="trend__seg trend__seg--pending" style={{ flexGrow: pending }} />}
      {paid > 0 && <span className="trend__seg trend__seg--paid" style={{ flexGrow: paid }} />}
    </span>
  )
}

/**
 * Ingresos y gastos de cada mes del año como columnas agrupadas: lo cobrado o
 * pagado en sólido y lo pendiente en un tono más claro encima. Al pasar el ratón,
 * tocar o recorrer los meses con las flechas, debajo se lee el detalle del mes.
 * Hay una vista de tabla equivalente con el acumulado.
 */
export function MonthlyTrendChart({
  series,
  year,
  initialMonth,
  currentMonth,
  onOpenMonth,
}: {
  series: MonthPoint[]
  year: number
  /** Mes que se detalla al principio. */
  initialMonth: number
  /** Mes de hoy si el año es el actual (se resalta). */
  currentMonth: number | null
  onOpenMonth: (month: number) => void
}) {
  const [asTable, setAsTable] = useState(false)
  const [active, setActive] = useState(initialMonth)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  const totals = series.flatMap((p) => [p.summary.incomePaid + p.summary.incomePending, p.summary.expensePaid + p.summary.expensePending])
  const max = Math.max(...totals)
  if (max === 0) {
    return <p className="muted">No hay ingresos ni gastos en {year}. Cuando apuntes alguno, verás aquí cómo va el año.</p>
  }

  const ticks = axisTicks(max)
  const top = ticks[ticks.length - 1]
  const hasPending = series.some((p) => p.summary.incomePending + p.summary.expensePending > 0)
  const activePoint = series[active - 1]

  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    const moves: Record<string, number> = { ArrowLeft: active - 1, ArrowRight: active + 1, Home: 1, End: 12 }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    const month = Math.min(12, Math.max(1, next))
    setActive(month)
    buttons.current[month - 1]?.focus()
  }

  return (
    <figure className="chart trend">
      <figcaption className="sr-only">Ingresos y gastos de cada mes de {year}</figcaption>
      <div className="chart__toolbar">
        <ul className="legend" aria-label="Leyenda">
          <li>
            <span className="legend__swatch legend__swatch--income" aria-hidden="true" />
            Ingresos
          </li>
          <li>
            <span className="legend__swatch legend__swatch--expense" aria-hidden="true" />
            Gastos
          </li>
          {hasPending && <li className="legend__note">Tono claro: pendiente o proyectado</li>}
        </ul>
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
                <th scope="col">Mes</th>
                <th scope="col" className="num">
                  Ingresos
                </th>
                <th scope="col" className="num">
                  Gastos
                </th>
                <th scope="col" className="num">
                  Resultado
                </th>
                <th scope="col" className="num">
                  Acumulado
                </th>
              </tr>
            </thead>
            <tbody>
              {series.map((p) => (
                <tr key={p.month} className={p.month === currentMonth ? 'is-current' : undefined}>
                  <th scope="row">{monthName(p.month)}</th>
                  <td className="num">{formatEuros(p.summary.incomePaid + p.summary.incomePending)}</td>
                  <td className="num">{formatEuros(p.summary.expensePaid + p.summary.expensePending)}</td>
                  <td className="num">
                    <Total cents={p.summary.forecast} />
                  </td>
                  <td className="num">
                    <Total cents={p.cumulativeForecast} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="trend__plot">
            <div className="trend__grid" aria-hidden="true">
              {ticks.map((tick) => (
                <span key={tick} className="trend__gridline" style={{ bottom: `${(tick / top) * 100}%` }}>
                  <span className="trend__tick">{formatCompactEuros(tick)}</span>
                </span>
              ))}
            </div>
            <ol className="trend__months" aria-label={`Meses de ${year}`} onKeyDown={onKeyDown}>
              {series.map((p) => (
                <li key={p.month}>
                  <button
                    ref={(element) => {
                      buttons.current[p.month - 1] = element
                    }}
                    type="button"
                    className={`trend__month${p.month === currentMonth ? ' trend__month--current' : ''}`}
                    tabIndex={p.month === active ? 0 : -1}
                    aria-pressed={p.month === active}
                    aria-label={describeMonth(p)}
                    onPointerEnter={() => setActive(p.month)}
                    onFocus={() => setActive(p.month)}
                    onClick={() => setActive(p.month)}
                  >
                    <span className="trend__cols" aria-hidden="true">
                      <Column paid={p.summary.incomePaid} pending={p.summary.incomePending} top={top} kind="income" />
                      <Column paid={p.summary.expensePaid} pending={p.summary.expensePending} top={top} kind="expense" />
                    </span>
                    <span className="trend__label" aria-hidden="true">
                      {shortMonthName(p.month)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className="trend__readout">
            <p>{describeMonth(activePoint)}</p>
            <button type="button" className="link-btn" onClick={() => onOpenMonth(activePoint.month)}>
              Ver {MONTH_NAMES[activePoint.month - 1]} en detalle
            </button>
          </div>
        </>
      )}
    </figure>
  )
}
