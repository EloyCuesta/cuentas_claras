import { useMemo, useState, type FormEvent } from 'react'
import { capitalize, formatMonthYear } from '../domain/dates.ts'
import { centsToInput, formatEuros, parseAmount, sumCents } from '../domain/money.ts'
import { monthPeriod, periodBounds, type YearMonth } from '../domain/period.ts'
import { budgetLines, type BudgetLine } from '../domain/summary.ts'
import { BudgetMeter } from '../components/BudgetMeter.tsx'
import { PeriodPicker } from '../components/PeriodPicker.tsx'
import { useFinance } from '../state/financeContext.ts'
import { describeStorageError } from '../state/storageErrors.ts'
import { useToast } from '../state/toastContext.ts'
import { useForecastMovements } from '../state/useForecastMovements.ts'

function BudgetEditor({ line, onDone }: { line: BudgetLine; onDone: () => void }) {
  const { actions } = useFinance()
  const { notify } = useToast()
  const [value, setValue] = useState(line.budgetCents === null ? '' : centsToInput(line.budgetCents))
  const [error, setError] = useState<string | null>(null)
  const inputId = `budget-${line.category.id}`

  const save = async (budgetCents: number | null) => {
    try {
      await actions.saveCategory({ ...line.category, budgetCents })
      notify(budgetCents === null ? `Presupuesto de ${line.category.name} quitado` : `Presupuesto de ${line.category.name} guardado`)
      onDone()
    } catch (err) {
      notify(describeStorageError(err), 'error')
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const parsed = parseAmount(value)
    if (!parsed.ok) {
      setError(parsed.error)
      document.getElementById(inputId)?.focus()
      return
    }
    void save(parsed.cents)
  }

  return (
    <form className="inline-form" onSubmit={submit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={inputId}>
          Presupuesto mensual para {line.category.name}
        </label>
        <div className="input-affix input-affix--short">
          <input
            id={inputId}
            className="input input--amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={value}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
            onChange={(event) => {
              setValue(event.target.value)
              setError(null)
            }}
            autoFocus
          />
          <span className="input-affix__suffix" aria-hidden="true">
            €
          </span>
        </div>
        {error && (
          <p className="field__error" id={`${inputId}-error`}>
            {error}
          </p>
        )}
      </div>
      <div className="inline-form__actions">
        <button type="submit" className="btn btn--primary">
          Guardar
        </button>
        {line.budgetCents !== null && (
          <button type="button" className="btn" onClick={() => void save(null)}>
            Quitar presupuesto
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

export function BudgetsPage({
  month,
  years,
  onMonthChange,
}: {
  month: YearMonth
  years: number[]
  onMonthChange: (value: YearMonth) => void
}) {
  const { data, today } = useFinance()
  const [editingId, setEditingId] = useState<string | null>(null)
  const period = useMemo(() => monthPeriod(month.year, month.month), [month.year, month.month])
  const movements = useForecastMovements(periodBounds(period).end)
  const lines = useMemo(() => budgetLines(movements, data.categories, period), [movements, data.categories, period])
  const withBudget = lines.filter((l) => l.budgetCents !== null)
  const totalBudget = sumCents(withBudget.map((l) => l.budgetCents as number))
  const totalSpent = sumCents(withBudget.map((l) => l.spentCents))
  const current = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }
  const monthName = formatMonthYear(month.year, month.month)

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title" tabIndex={-1}>
          Presupuestos
        </h1>
        <PeriodPicker kind="mensual" value={month} onChange={onMonthChange} current={current} years={years} />
      </header>
      <p className="lede">
        Fija cuánto quieres gastar como máximo cada mes en cada categoría. El consumo cuenta lo ya pagado en{' '}
        {monthName}; lo pendiente se muestra aparte, en un tono más claro.
      </p>

      {withBudget.length > 0 && (
        <section className="sheet budget-total" aria-label={`Total de ${monthName}`}>
          <h2 className="section-title">{capitalize(monthName)}</h2>
          <p>
            Has gastado <strong>{formatEuros(totalSpent)}</strong> de los <strong>{formatEuros(totalBudget)}</strong>{' '}
            presupuestados en {withBudget.length} {withBudget.length === 1 ? 'categoría' : 'categorías'}.
          </p>
        </section>
      )}

      <ul className="budget-list">
        {lines.map((line) => (
          <li key={line.category.id} className="sheet budget-item">
            <div className="budget-item__head">
              <h2 className="budget-item__name">{line.category.name}</h2>
              {editingId !== line.category.id && (
                <button type="button" className="btn btn--small" onClick={() => setEditingId(line.category.id)}>
                  {line.budgetCents === null ? 'Fijar presupuesto' : 'Cambiar'}
                  <span className="sr-only">
                    {line.budgetCents === null ? ` para ${line.category.name}` : ` el presupuesto de ${line.category.name}`}
                  </span>
                </button>
              )}
            </div>
            {editingId === line.category.id ? (
              <BudgetEditor line={line} onDone={() => setEditingId(null)} />
            ) : line.budgetCents === null ? (
              <p className="muted">
                Sin presupuesto. {line.spentCents > 0 ? `Llevas ${formatEuros(line.spentCents)} gastados este mes.` : ''}
              </p>
            ) : (
              <BudgetMeter line={line} />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
