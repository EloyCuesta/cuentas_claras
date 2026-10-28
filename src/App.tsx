import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, LogoMark, type IconName } from './components/Icon.tsx'
import { MovementDialog } from './components/MovementDialog.tsx'
import { PaymentDialog } from './components/PaymentDialog.tsx'
import { formatDate, todayISO } from './domain/dates.ts'
import { EMPTY_FILTERS, type MovementFilters } from './domain/filters.ts'
import type { YearMonth } from './domain/period.ts'
import { effectiveDate } from './domain/summary.ts'
import type { Movement, MovementType } from './domain/types.ts'
import { BudgetsPage } from './pages/BudgetsPage.tsx'
import { MovementsPage } from './pages/MovementsPage.tsx'
import { RecurringPage } from './pages/RecurringPage.tsx'
import { SettingsPage } from './pages/SettingsPage.tsx'
import { SummaryPage } from './pages/SummaryPage.tsx'
import { YearPage } from './pages/YearPage.tsx'
import { useFinance } from './state/financeContext.ts'
import { yearRange } from './ui/helpers.ts'
import { navigate, useHashRoute, type Route } from './ui/useHashRoute.ts'

const NAV: { route: Route; label: string; icon: IconName }[] = [
  { route: 'resumen', label: 'Resumen', icon: 'summary' },
  { route: 'movimientos', label: 'Movimientos', icon: 'list' },
  { route: 'recurrentes', label: 'Recurrentes', icon: 'repeat' },
  { route: 'presupuestos', label: 'Presupuestos', icon: 'gauge' },
  { route: 'ajustes', label: 'Ajustes', icon: 'settings' },
]

/** La plantilla anual vive dentro de «Resumen» (se cambia con Mes | Año), sin entrada propia en el menú. */
const navRouteOf = (route: Route): Route => (route === 'anual' ? 'resumen' : route)

type Editor =
  | { kind: 'movement'; movement: Movement | null; type: MovementType }
  | { kind: 'payment'; movement: Movement }
  | null

export default function App() {
  const { data, today, lastBackupAt } = useFinance()
  const route = useHashRoute()
  const [month, setMonth] = useState<YearMonth>(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }))
  const [filters, setFilters] = useState<MovementFilters>(EMPTY_FILTERS)
  const [editor, setEditor] = useState<Editor>(null)
  const firstRender = useRef(true)

  const years = useMemo(
    () => yearRange(Number(today.slice(0, 4)), data.movements.map(effectiveDate), month.year),
    [today, data.movements, month.year],
  )

  // Al cambiar de sección: título de la pestaña, scroll arriba y foco en el título (lectores de pantalla).
  useEffect(() => {
    const label = route === 'anual' ? 'Año' : (NAV.find((item) => item.route === route)?.label ?? 'Resumen')
    document.title = `${label} — Cuentas claras`
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    window.scrollTo({ top: 0 })
    document.querySelector<HTMLElement>('main h1')?.focus()
  }, [route])

  const openNew = (type: MovementType = 'gasto') => setEditor({ kind: 'movement', movement: null, type })
  const openEdit = (movement: Movement) => setEditor({ kind: 'movement', movement, type: movement.type })
  const openPay = (movement: Movement) => setEditor({ kind: 'payment', movement })
  const showPending = () => {
    setFilters({ ...EMPTY_FILTERS, status: 'pendiente' })
    navigate('movimientos')
  }
  const openMonth = (value: number) => {
    setMonth({ year: month.year, month: value })
    navigate('resumen')
  }

  let page
  switch (route) {
    case 'movimientos':
      page = <MovementsPage filters={filters} onFiltersChange={setFilters} onAdd={openNew} onEdit={openEdit} onPay={openPay} />
      break
    case 'recurrentes':
      page = <RecurringPage />
      break
    case 'presupuestos':
      page = <BudgetsPage month={month} years={years} onMonthChange={setMonth} />
      break
    case 'ajustes':
      page = <SettingsPage />
      break
    case 'anual':
      page = <YearPage month={month} years={years} onMonthChange={setMonth} onOpenMonth={openMonth} />
      break
    default:
      page = (
        <SummaryPage
          month={month}
          years={years}
          onMonthChange={setMonth}
          onAdd={openNew}
          onEdit={openEdit}
          onPay={openPay}
          onShowPending={showPending}
        />
      )
  }

  return (
    <div className="shell">
      <a
        className="skip-link"
        href="#contenido"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('contenido')?.focus()
        }}
      >
        Saltar al contenido
      </a>
      <header className="shell__side">
        <a className="brand" href="#resumen">
          <LogoMark />
          <span>Cuentas claras</span>
        </a>
        <button type="button" className="btn btn--primary shell__add" onClick={() => openNew()}>
          <Icon name="plus" />
          Añadir movimiento
        </button>
        <nav className="nav" aria-label="Secciones">
          <ul className="nav__list">
            {NAV.map((item) => (
              <li key={item.route}>
                <a
                  className="nav__link"
                  href={`#${item.route}`}
                  aria-current={route === item.route ? 'page' : navRouteOf(route) === item.route ? 'true' : undefined}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <p className="shell__note">
          Tus datos se guardan en la base de datos de este equipo.{' '}
          {lastBackupAt ? `Última copia: ${formatDate(todayISO(new Date(lastBackupAt)))}.` : 'Aún no has descargado ninguna copia.'}{' '}
          <a href="#ajustes">Copias de seguridad</a>
        </p>
      </header>

      <main id="contenido" className="shell__main" tabIndex={-1}>
        {page}
      </main>

      <button type="button" className="fab" onClick={() => openNew()}>
        <Icon name="plus" size={22} />
        Añadir<span className="sr-only"> movimiento</span>
      </button>

      {editor?.kind === 'movement' && (
        <MovementDialog movement={editor.movement} initialType={editor.type} onClose={() => setEditor(null)} />
      )}
      {editor?.kind === 'payment' && <PaymentDialog movement={editor.movement} onClose={() => setEditor(null)} />}
    </div>
  )
}
