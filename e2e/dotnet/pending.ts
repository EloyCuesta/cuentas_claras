/**
 * Rutas que la app pide al abrir y que el host .NET todavía no tiene. Mientras falten, las pruebas de la app contra
 * .NET las responden con lo mismo que daría el servidor con la base vacía, para poder probar ya lo que sí está
 * migrado. Cada ID quita las suyas al implementarlas (docs/migration/STATUS.md); al terminar, la lista queda vacía.
 * Nunca se usan contra Express.
 */
export interface PendingRoute {
  method: 'GET' | 'POST'
  path: string
  /** El ID de docs/migration/STATUS.md que la implementa. */
  until: string
  data: unknown
}

export const PENDING_DOTNET_ROUTES: readonly PendingRoute[] = [
  { method: 'GET', path: '/api/despensa/presupuesto', until: 'PAN-03', data: { monthlyBudgetCents: null, lastReviewDate: null } },
  { method: 'GET', path: '/api/despensa/actividad', until: 'PAN-03', data: { purchases: [], events: [] } },
  { method: 'GET', path: '/api/despensa/tickets', until: 'TIC-04', data: [] },
]
