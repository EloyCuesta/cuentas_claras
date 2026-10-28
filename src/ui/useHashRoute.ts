import { useEffect, useState } from 'react'

/**
 * Navegación mínima con el "hash" de la URL (#movimientos, #anual, #ajustes…).
 * No necesita servidor ni librería: funciona abriendo los archivos estáticos.
 */
export const ROUTES = ['resumen', 'anual', 'movimientos', 'recurrentes', 'presupuestos', 'ajustes'] as const
export type Route = (typeof ROUTES)[number]

function parse(hash: string): Route {
  const name = hash.replace(/^#\/?/, '')
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : 'resumen'
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(route: Route): void {
  window.location.hash = route
}
