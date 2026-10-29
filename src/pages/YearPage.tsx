import { useMemo } from 'react'
import { categoryMonthMatrix, monthlySeries } from '../../shared/finance/annual.ts'
import { yearTemplateCsv } from '../../shared/finance/csv.ts'
import { periodBounds, yearPeriod, type YearMonth } from '../../shared/finance/period.ts'
import { budgetLines, periodSummary } from '../../shared/finance/summary.ts'
import { BudgetSummary } from '../components/BudgetSummary.tsx'
import { CategoryMonthGrid } from '../components/CategoryMonthGrid.tsx'
import { Icon } from '../components/Icon.tsx'
import { Ledger } from '../components/Ledger.tsx'
import { MonthlyTrendChart } from '../components/MonthlyTrendChart.tsx'
import { PeriodPicker } from '../components/PeriodPicker.tsx'
import { PeriodSwitch } from '../components/PeriodSwitch.tsx'
import { Section } from '../components/Section.tsx'
import { useFinance } from '../state/financeContext.ts'
import { useForecastMovements } from '../state/useForecastMovements.ts'
import { downloadFile } from '../ui/helpers.ts'

/** Plantilla anual: las cuentas del año, su evolución mes a mes, cada categoría por meses y el presupuesto anual. */
export function YearPage({
  month,
  years,
  onMonthChange,
  onOpenMonth,
}: {
  month: YearMonth
  years: number[]
  onMonthChange: (value: YearMonth) => void
  /** Abre la plantilla mensual de un mes de este año. */
  onOpenMonth: (month: number) => void
}) {
  const { data, today } = useFinance()
  const year = month.year
  const period = useMemo(() => yearPeriod(year), [year])
  const movements = useForecastMovements(periodBounds(period).end)
  const summary = useMemo(() => periodSummary(movements, period), [movements, period])
  const series = useMemo(() => monthlySeries(movements, year), [movements, year])
  const income = useMemo(() => categoryMonthMatrix(movements, data.categories, year, 'ingreso'), [movements, data.categories, year])
  const expense = useMemo(() => categoryMonthMatrix(movements, data.categories, year, 'gasto'), [movements, data.categories, year])
  const budgets = useMemo(() => budgetLines(movements, data.categories, period), [movements, data.categories, period])
  const current = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }
  const currentMonth = year === current.year ? current.month : null

  const downloadTemplate = () => {
    downloadFile(`﻿${yearTemplateCsv(income, expense, series)}`, `cuentas-claras-ano-${year}.csv`, 'text/csv;charset=utf-8')
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title page-title--month" tabIndex={-1}>
          {year}
        </h1>
        <div className="page-header__tools">
          <PeriodSwitch kind="anual" />
          <PeriodPicker kind="anual" value={month} onChange={onMonthChange} current={current} years={years} />
        </div>
      </header>

      <div className="summary-grid">
        <div className="summary-col">
          <Ledger summary={summary} period={period} />
        </div>
        <div className="summary-col">
          <Section id="trend" title="¿Cómo va el año?">
            <MonthlyTrendChart
              key={year}
              series={series}
              year={year}
              initialMonth={month.month}
              currentMonth={currentMonth}
              onOpenMonth={onOpenMonth}
            />
          </Section>
          <BudgetSummary id="budget" title="Presupuesto anual" lines={budgets} period={period} />
        </div>
      </div>

      <Section
        id="grid"
        title="Mes a mes por categoría"
        aside={
          <button type="button" className="btn btn--ghost btn--small" onClick={downloadTemplate}>
            <Icon name="download" size={18} />
            Descargar hoja de cálculo
          </button>
        }
      >
        <p className="section-sub">
          Importes en euros. Cada celda suma lo cobrado o pagado y lo pendiente; en gris, las que incluyen algo pendiente
          o proyectado.
        </p>
        <CategoryMonthGrid income={income} expense={expense} year={year} currentMonth={currentMonth} />
      </Section>
    </div>
  )
}
