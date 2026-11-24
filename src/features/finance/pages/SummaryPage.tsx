import { useMemo } from 'react'
import { indexCategories } from '#shared/finance/categories.ts'
import { monthTemplateCsv } from '#shared/finance/csv.ts'
import { capitalize, daysBetween, todayISO } from '#shared/common/dates.ts'
import { formatEuros } from '#shared/common/money.ts'
import { formatPeriod, monthPeriod, type YearMonth } from '#shared/finance/period.ts'
import { pendingByDueDate } from '#shared/finance/summary.ts'
import type { Movement, MovementType } from '#shared/finance/types.ts'
import { BudgetSummary } from '../components/BudgetSummary.tsx'
import { CategoryChart } from '../components/CategoryChart.tsx'
import { CategoryTable } from '../components/CategoryTable.tsx'
import { DueList } from '../components/DueList.tsx'
import { EmptyState } from '../../../ui/EmptyState.tsx'
import { Icon } from '../../../ui/Icon.tsx'
import { Ledger } from '../components/Ledger.tsx'
import { PeriodPicker } from '../components/PeriodPicker.tsx'
import { PeriodSwitch } from '../components/PeriodSwitch.tsx'
import { Section } from '../../../ui/Section.tsx'
import { useFinance } from '../financeContext.ts'
import { SummaryPending } from '../components/SummaryPending.tsx'
import { useMonthView } from '../useSummaryView.ts'
import { downloadFile } from '../../../ui/helpers.ts'

const UPCOMING_LIMIT = 5

/** Plantilla mensual: las cuentas del mes, en qué se va el dinero, pendientes, presupuestos y el detalle por categoría. */
export function SummaryPage({
  month,
  years,
  onMonthChange,
  onAdd,
  onEdit,
  onPay,
  onShowPending,
}: {
  month: YearMonth
  years: number[]
  onMonthChange: (value: YearMonth) => void
  onAdd: (type?: MovementType) => void
  onEdit: (movement: Movement) => void
  onPay: (movement: Movement) => void
  onShowPending: () => void
}) {
  const { data, today, lastBackupAt } = useFinance()
  const period = useMemo(() => monthPeriod(month.year, month.month), [month.year, month.month])
  // La cuenta, los gastos por categoría, los presupuestos y el detalle (con lo proyectado de los recurrentes).
  const state = useMonthView(month.year, month.month)
  const view = state.status === 'ready' ? state.view : null
  const categories = useMemo(() => indexCategories(data.categories), [data.categories])
  // Los pendientes que se pueden pagar son los guardados, nunca los proyectados.
  const pending = useMemo(() => pendingByDueDate(data.movements, today), [data.movements, today])
  const payments = [...pending.overdue, ...pending.upcoming].filter((m) => m.type === 'gasto')
  const collections = [...pending.overdue, ...pending.upcoming].filter((m) => m.type === 'ingreso')
  const shownPayments = payments.slice(0, Math.max(UPCOMING_LIMIT, pending.overdue.filter((m) => m.type === 'gasto').length))
  const monthName = formatPeriod(period)
  const current = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }
  const isEmpty = data.movements.length === 0 && data.recurring.length === 0
  const backupAge = lastBackupAt ? daysBetween(todayISO(new Date(lastBackupAt)), today) : null
  const remindBackup = data.movements.length > 0 && (backupAge === null || backupAge > 30)

  // En una columna (el móvil), lo pendiente queda debajo de la cuenta: un aviso arriba lleva a los vencidos.
  const showOverdue = () => {
    const heading = document.getElementById('due-title')
    if (!heading) return
    heading.tabIndex = -1
    heading.scrollIntoView({ block: 'start' })
    heading.focus({ preventScroll: true })
  }

  const downloadTemplate = () => {
    if (!view) return
    const fileName = `cuentas-claras-mes-${month.year}-${String(month.month).padStart(2, '0')}.csv`
    downloadFile(`﻿${monthTemplateCsv(view.breakdown)}`, fileName, 'text/csv;charset=utf-8')
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title page-title--month" tabIndex={-1}>
          {capitalize(monthName)}
        </h1>
        <div className="page-header__tools">
          <PeriodSwitch kind="mensual" />
          <PeriodPicker kind="mensual" value={month} onChange={onMonthChange} current={current} years={years} />
        </div>
      </header>

      {isEmpty && (
        <EmptyState
          title="Empieza apuntando tu primer gasto"
          actions={
            <>
              <button type="button" className="btn btn--primary" onClick={() => onAdd('gasto')}>
                <Icon name="plus" />
                Añadir un gasto
              </button>
              <button type="button" className="btn" onClick={() => onAdd('ingreso')}>
                Añadir un ingreso
              </button>
              <a className="btn btn--ghost" href="#recurrentes">
                Configurar pagos recurrentes
              </a>
            </>
          }
        >
          <p>
            Pulsa «Añadir un gasto», escribe el importe y el concepto y elige una categoría. Para el alquiler, los recibos
            o las cuotas de un préstamo, crea un pago recurrente y la aplicación preparará cada vencimiento.
          </p>
          <p>Tus datos se guardan en una base de datos MySQL de este equipo.</p>
        </EmptyState>
      )}

      {remindBackup && (
        <p className="notice notice--warning">
          <Icon name="info" />
          <span>
            {backupAge === null
              ? 'Aún no has descargado ninguna copia de seguridad.'
              : `Tu última copia de seguridad es de hace ${backupAge} días.`}{' '}
            Los datos solo están en este equipo. <a href="#ajustes">Descargar una copia</a>
          </span>
        </p>
      )}

      {view && pending.overdue.length > 0 && (
        <p className="notice notice--error summary-overdue">
          <Icon name="alert" />
          <span>{pending.overdue.length === 1 ? '1 vencido' : `${pending.overdue.length} vencidos`}</span>
          <button type="button" className="link-btn" onClick={showOverdue}>
            Ver los vencidos
          </button>
        </p>
      )}

      {view ? (
        <>
          <div className="summary-grid">
            <div className="summary-col">
              <Ledger summary={view.summary} period={period} />
              <Section
                id="where"
                className="summary-grid__chart"
                title="¿En qué se me va el dinero?"
                aside={
                  view.summary.expensePaid + view.summary.expensePending > 0 && (
                    <span className="muted small">Total: {formatEuros(view.summary.expensePaid + view.summary.expensePending)}</span>
                  )
                }
              >
                <CategoryChart totals={view.expensesByCategory} periodName={monthName} />
              </Section>
            </div>
            <div className="summary-col">
              <Section id="due" className="summary-grid__due" title="¿Qué pagos tengo pendientes?">
                {payments.length === 0 ? (
                  <p className="muted">No tienes pagos pendientes. Los vencimientos de tus recurrentes aparecerán aquí.</p>
                ) : (
                  <>
                    <p className="section-sub">Próximos vencimientos, empezando por los que ya han vencido.</p>
                    <DueList items={shownPayments} today={today} categories={categories} onPay={onPay} onEdit={onEdit} />
                  </>
                )}
                {collections.length > 0 && (
                  <>
                    <h3 className="subsection-title">Cobros pendientes</h3>
                    <DueList items={collections.slice(0, 3)} today={today} categories={categories} onPay={onPay} onEdit={onEdit} />
                  </>
                )}
                {payments.length + collections.length > 0 && (
                  <button type="button" className="link-btn section-more" onClick={onShowPending}>
                    Ver todos los pendientes ({payments.length + collections.length})
                  </button>
                )}
              </Section>

              <BudgetSummary id="budget" className="summary-grid__budget" title="Presupuestos" lines={view.budgetLines} period={period} />
            </div>
          </div>

          <Section
            id="detail"
            title="Detalle por categoría"
            aside={
              <button type="button" className="btn btn--ghost btn--small" onClick={downloadTemplate}>
                <Icon name="download" size={18} />
                Descargar hoja de cálculo
              </button>
            }
          >
            <p className="section-sub">
              Real es lo ya cobrado o pagado; pendiente, lo previsto que falta. «Queda» es el presupuesto menos el total.
            </p>
            <CategoryTable breakdown={view.breakdown} periodName={monthName} />
          </Section>
        </>
      ) : (
        <SummaryPending state={state} />
      )}
    </div>
  )
}
