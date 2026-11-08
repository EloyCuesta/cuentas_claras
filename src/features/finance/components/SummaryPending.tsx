import type { SummaryState } from '../useSummaryView.ts'

/**
 * Mientras el servidor calcula el resumen (solo con la web compilada para .NET, FIN-04), o si no ha podido: el aviso
 * ocupa el sitio de las cuentas. Contra Express el resumen se calcula en el navegador y esto no llega a verse.
 */
export function SummaryPending({ state }: { state: SummaryState<unknown> }) {
  if (state.status === 'error') {
    return (
      <p className="notice notice--error" role="alert">
        No se ha podido calcular el resumen: {state.message}
      </p>
    )
  }
  return (
    <p className="muted" role="status">
      Calculando el resumen…
    </p>
  )
}
