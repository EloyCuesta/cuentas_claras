import { useMemo } from 'react'
import { yearTemplateCsv } from '#shared/finance/csv.ts'
import { yearPeriod, type YearMonth } from '#shared/finance/period.ts'
import { BudgetSummary } from '../components/BudgetSummary.tsx'
import { CategoryMonthGrid } from '../components/CategoryMonthGrid.tsx'
import { Icon } from '../../../ui/Icon.tsx'
import { Ledger } from '../components/Ledger.tsx'
import { MonthlyTrendChart } from '../components/MonthlyTrendChart.tsx'
import { PeriodPicker } from '../components/PeriodPicker.tsx'
import { PeriodSwitch } from '../components/PeriodSwitch.tsx'
import { Section } from '../../../ui/Section.tsx'
import { useFinance } from '../financeContext.ts'
import { SummaryPending } from '../components/SummaryPending.tsx'
import { useYearView } from '../useSummaryView.ts'
import { downloadFile } from '../../../ui/helpers.ts'

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
  const { today } = useFinance()
  const year = month.year
  const period = useMemo(() => yearPeriod(year), [year])
  // La cuenta del año, la evolución mes a mes, las categorías por meses y el presupuesto anual (con lo proyectado).
  const state = useYearView(year)
  const view = state.status === 'ready' ? state.view : null
  const current = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }
  const currentMonth = year === current.year ? current.month : null

  const downloadTemplate = () => {
    if (!view) return
    downloadFile(`﻿${yearTemplateCsv(view.income, view.expense, view.series)}`, `cuentas-claras-ano-${year}.csv`, 'text/csv;charset=utf-8')
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

      {view ? (
        <>
          <div className="summary-grid">
            <div className="summary-col">
              <Ledger summary={view.summary} period={period} />
            </div>
            <div className="summary-col">
              <Section id="trend" title="¿Cómo va el año?">
                <MonthlyTrendChart
                  key={year}
                  series={view.series}
                  year={year}
                  initialMonth={month.month}
                  currentMonth={currentMonth}
                  onOpenMonth={onOpenMonth}
                />
              </Section>
              <BudgetSummary id="budget" title="Presupuesto anual" lines={view.budgetLines} period={period} />
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
              Importes en euros. Cada celda suma lo cobrado o pagado y lo pendiente; en gris, las que incluyen algo
              pendiente o proyectado.
            </p>
            <CategoryMonthGrid income={view.income} expense={view.expense} year={year} currentMonth={currentMonth} />
          </Section>
        </>
      ) : (
        <SummaryPending state={state} />
      )}
    </div>
  )
}
