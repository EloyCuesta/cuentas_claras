import type { Period } from '../domain/period.ts'

/** Cambia entre la plantilla mensual (#resumen) y la anual (#anual). */
export function PeriodSwitch({ kind }: { kind: Period['kind'] }) {
  return (
    <nav className="period-switch" aria-label="Plantilla">
      <a className="period-switch__link" href="#resumen" aria-current={kind === 'mensual' ? 'page' : undefined}>
        Mes
      </a>
      <a className="period-switch__link" href="#anual" aria-current={kind === 'anual' ? 'page' : undefined}>
        Año
      </a>
    </nav>
  )
}
