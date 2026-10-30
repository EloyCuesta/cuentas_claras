import { useMemo, useState } from 'react'
import { formatEuros, MINUS, sumCents } from '../../../shared/core/money.ts'
import { categoryOptions, indexCategories } from '../../../shared/finance/categories.ts'
import { movementsToCsv } from '../../../shared/finance/csv.ts'
import { countActiveFilters, EMPTY_FILTERS, filterMovements, type MovementFilters } from '../../../shared/finance/filters.ts'
import type { Movement, MovementType } from '../../../shared/finance/types.ts'
import { EmptyState } from '../../ui/EmptyState.tsx'
import { downloadFile } from '../../ui/helpers.ts'
import { Icon } from '../../ui/Icon.tsx'
import { useToast } from '../../ui/toastContext.ts'
import { MovementList } from '../components/MovementList.tsx'
import { useFinance } from '../financeContext.ts'

const PAGE_SIZE = 100

export function MovementsPage({
  filters,
  onFiltersChange,
  onAdd,
  onEdit,
  onPay,
}: {
  filters: MovementFilters
  onFiltersChange: (filters: MovementFilters) => void
  onAdd: (type?: MovementType) => void
  onEdit: (movement: Movement) => void
  onPay: (movement: Movement) => void
}) {
  const { data, today } = useFinance()
  const { notify } = useToast()
  const [panelOpen, setPanelOpen] = useState(false)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const categories = useMemo(() => indexCategories(data.categories), [data.categories])
  const rules = useMemo(() => new Map(data.recurring.map((r) => [r.id, r])), [data.recurring])
  const results = useMemo(() => filterMovements(data.movements, data.categories, filters), [data.movements, data.categories, filters])
  const activeFilters = countActiveFilters({ ...filters, text: '' })
  // Totales de lo ya cobrado y pagado; lo pendiente solo se cuenta (es previsión, no dinero real).
  const realized = results.filter((m) => m.status === 'realizado')
  const income = sumCents(realized.filter((m) => m.type === 'ingreso').map((m) => m.amountCents))
  const expense = sumCents(realized.filter((m) => m.type === 'gasto').map((m) => m.amountCents))
  const pendingCount = results.length - realized.length

  const update = (patch: Partial<MovementFilters>) => {
    onFiltersChange({ ...filters, ...patch })
    setVisible(PAGE_SIZE)
  }

  const exportFiltered = () => {
    downloadFile(`\uFEFF${movementsToCsv(results, data.categories)}`, `cuentas-claras-movimientos-${today}.csv`, 'text/csv;charset=utf-8')
    notify(`CSV descargado con ${results.length} movimientos`)
  }

  if (data.movements.length === 0) {
    return (
      <div className="page">
        <header className="page-header">
          <h1 className="page-title" tabIndex={-1}>
            Movimientos
          </h1>
        </header>
        <EmptyState
          title="Todavía no has apuntado ningún movimiento"
          actions={
            <>
              <button type="button" className="btn btn--primary" onClick={() => onAdd('gasto')}>
                <Icon name="plus" />
                Añadir un gasto
              </button>
              <button type="button" className="btn" onClick={() => onAdd('ingreso')}>
                Añadir un ingreso
              </button>
            </>
          }
        >
          <p>Aquí verás todos tus ingresos y gastos, con búsqueda por concepto y filtros por fecha, categoría, tipo y estado.</p>
        </EmptyState>
      </div>
    )
  }

  const typeOptions: { value: MovementType | ''; label: string }[] = [
    { value: '', label: 'Todos' },
    { value: 'gasto', label: 'Gastos' },
    { value: 'ingreso', label: 'Ingresos' },
  ]

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title" tabIndex={-1}>
          Movimientos
        </h1>
        <button type="button" className="btn btn--primary hide-mobile" onClick={() => onAdd()}>
          <Icon name="plus" />
          Añadir movimiento
        </button>
      </header>

      <section className={`filters${panelOpen ? ' filters--open' : ''}`} aria-label="Buscar y filtrar">
        <div className="filters__top">
          <div className="search">
            <Icon name="search" />
            <label className="sr-only" htmlFor="filter-text">
              Buscar por concepto
            </label>
            <input
              id="filter-text"
              type="search"
              className="input"
              placeholder="Buscar por concepto"
              value={filters.text}
              onChange={(event) => update({ text: event.target.value })}
            />
          </div>
          <button
            type="button"
            className="btn filters__toggle"
            aria-expanded={panelOpen}
            aria-controls="filters-panel"
            onClick={() => setPanelOpen(!panelOpen)}
          >
            Filtros{activeFilters > 0 ? ` (${activeFilters})` : ''}
          </button>
        </div>
        <div className="filters__panel" id="filters-panel">
          <div className="field">
            <label className="field__label" htmlFor="filter-from">
              Desde
            </label>
            <input id="filter-from" type="date" className="input" value={filters.from} onChange={(e) => update({ from: e.target.value })} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="filter-to">
              Hasta
            </label>
            <input id="filter-to" type="date" className="input" value={filters.to} onChange={(e) => update({ to: e.target.value })} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="filter-category">
              Categoría
            </label>
            <select
              id="filter-category"
              className="select"
              value={filters.categoryId}
              onChange={(e) => update({ categoryId: e.target.value })}
            >
              <option value="">Todas</option>
              <optgroup label="Gastos">
                {categoryOptions(data.categories, 'gasto').map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Ingresos">
                {categoryOptions(data.categories, 'ingreso').map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="filter-type">
              Tipo
            </label>
            <select
              id="filter-type"
              className="select"
              value={filters.type}
              onChange={(e) => update({ type: e.target.value as MovementType | '' })}
            >
              {typeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="filter-status">
              Estado
            </label>
            <select
              id="filter-status"
              className="select"
              value={filters.status}
              onChange={(e) => update({ status: e.target.value as MovementFilters['status'] })}
            >
              <option value="">Todos</option>
              <option value="realizado">Cobrados y pagados</option>
              <option value="pendiente">Pendientes</option>
            </select>
          </div>
          <button
            type="button"
            className="btn btn--ghost filters__clear"
            onClick={() => update(EMPTY_FILTERS)}
            disabled={countActiveFilters(filters) === 0}
          >
            Quitar filtros
          </button>
        </div>
      </section>

      <div className="results-bar" aria-live="polite">
        <span>
          <strong>{results.length}</strong> {results.length === 1 ? 'movimiento' : 'movimientos'}
        </span>
        {income > 0 && (
          <span>
            Cobrado <strong className="amount amount--ingreso">+{formatEuros(income)}</strong>
          </span>
        )}
        {expense > 0 && (
          <span>
            Pagado <strong className="amount">
              {MINUS}
              {formatEuros(expense)}
            </strong>
          </span>
        )}
        {pendingCount > 0 && (
          <span className="chip">{pendingCount === 1 ? '1 pendiente' : `${pendingCount} pendientes`}</span>
        )}
        {activeFilters > 0 && !panelOpen && (
          <button type="button" className="link-btn hide-desktop" onClick={() => update(EMPTY_FILTERS)}>
            Quitar filtros
          </button>
        )}
        {results.length > 0 && (
          <button type="button" className="btn btn--ghost btn--small results-bar__export" onClick={exportFiltered}>
            <Icon name="download" size={18} />
            Exportar estos a CSV
          </button>
        )}
      </div>

      {results.length === 0 ? (
        <EmptyState
          title="Ningún movimiento coincide"
          actions={
            <button type="button" className="btn" onClick={() => update(EMPTY_FILTERS)}>
              Quitar filtros
            </button>
          }
        >
          <p>Prueba con otro texto o quita alguno de los filtros.</p>
        </EmptyState>
      ) : (
        <div className="sheet sheet--flush">
          <MovementList
            movements={results.slice(0, visible)}
            today={today}
            categories={categories}
            rules={rules}
            onEdit={onEdit}
            onPay={onPay}
          />
          {results.length > visible && (
            <div className="list-more">
              <button type="button" className="btn" onClick={() => setVisible(visible + PAGE_SIZE)}>
                Mostrar más ({results.length - visible} restantes)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
