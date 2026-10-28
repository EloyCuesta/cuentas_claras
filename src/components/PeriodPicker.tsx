import { capitalize, MONTH_NAMES } from '../domain/dates.ts'
import { monthPeriod, shiftPeriod, yearPeriod, type Period, type YearMonth } from '../domain/period.ts'
import { Icon } from './Icon.tsx'

/**
 * Selector de periodo con flechas para ir al anterior o al siguiente. En modo
 * mensual elige mes y año; en modo anual, solo el año (y conserva el mes, para
 * volver a él al pasar a la vista mensual).
 */
export function PeriodPicker({
  kind,
  value,
  onChange,
  current,
  years,
}: {
  kind: Period['kind']
  value: YearMonth
  onChange: (value: YearMonth) => void
  current: YearMonth
  years: number[]
}) {
  const monthly = kind === 'mensual'
  const isCurrent = value.year === current.year && (!monthly || value.month === current.month)
  const unit = monthly ? 'Mes' : 'Año'
  const shift = (delta: number) => {
    const next = shiftPeriod(monthly ? monthPeriod(value.year, value.month) : yearPeriod(value.year), delta)
    onChange({ year: next.year, month: next.kind === 'mensual' ? next.month : value.month })
  }

  return (
    <div className="month-picker" role="group" aria-label={monthly ? 'Elegir mes' : 'Elegir año'}>
      <button type="button" className="icon-btn icon-btn--bordered" aria-label={`${unit} anterior`} onClick={() => shift(-1)}>
        <Icon name="chevronLeft" />
      </button>
      {monthly && (
        <>
          <label className="sr-only" htmlFor="period-picker-month">
            Mes
          </label>
          <select
            id="period-picker-month"
            className="select select--compact"
            value={value.month}
            onChange={(event) => onChange({ year: value.year, month: Number(event.target.value) })}
          >
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={index + 1}>
                {capitalize(name)}
              </option>
            ))}
          </select>
        </>
      )}
      <label className="sr-only" htmlFor="period-picker-year">
        Año
      </label>
      <select
        id="period-picker-year"
        className="select select--compact"
        value={value.year}
        onChange={(event) => onChange({ year: Number(event.target.value), month: value.month })}
      >
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
      <button type="button" className="icon-btn icon-btn--bordered" aria-label={`${unit} siguiente`} onClick={() => shift(1)}>
        <Icon name="chevronRight" />
      </button>
      {!isCurrent && (
        <button type="button" className="btn btn--ghost btn--small" onClick={() => onChange(current)}>
          {unit} actual
        </button>
      )}
    </div>
  )
}
