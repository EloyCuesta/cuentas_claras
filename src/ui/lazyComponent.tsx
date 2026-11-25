import { useEffect, useState, type ComponentType, type ReactNode } from 'react'

/**
 * Un componente que va en su propio archivo JS y se descarga la primera vez que se pinta (con `import()`), como
 * React.lazy pero sin `<Suspense>`. React retrasa unos 300 ms lo que llega después de enseñar el «fallback» de un
 * Suspense (FALLBACK_THROTTLE_MS), y al abrir las cuentas se notaba (UX-06). Mientras llega se enseña `fallback`;
 * si no llega, el error sube a LoadBoundary (`src/ui/Loading.tsx`). Las veces siguientes ya está y se pinta al momento.
 */
export function lazyComponent<P extends object>(load: () => Promise<ComponentType<P>>, fallback: ReactNode = null): ComponentType<P> {
  let loaded: ComponentType<P> | null = null
  let pending: Promise<ComponentType<P>> | null = null
  const start = () => {
    pending ??= load().then(
      (component) => (loaded = component),
      (error: unknown) => {
        // Si falla, la vez siguiente se vuelve a intentar.
        pending = null
        throw error
      },
    )
    return pending
  }

  function Lazy(props: P) {
    const [, setReady] = useState(loaded !== null)
    const [error, setError] = useState<unknown>(null)
    useEffect(() => {
      if (loaded) return
      let current = true
      start().then(
        () => current && setReady(true),
        (failure: unknown) => current && setError(failure),
      )
      return () => {
        current = false
      }
    }, [])
    if (error) throw error
    const Component = loaded
    return Component ? <Component {...props} /> : fallback
  }
  return Lazy
}
