import { Component, type ReactNode } from 'react'

/**
 * Mientras carga: la forma de lo que viene, en gris (decorativa, oculta a los lectores de pantalla), con el texto de
 * carga de siempre («Cargando la despensa…»), visible y anunciado (role="status").
 */
export function Skeleton({ label, blocks = 3 }: { label: string; blocks?: number }) {
  return (
    <div className="skeleton" role="status">
      <p className="skeleton__label">{label}</p>
      {Array.from({ length: blocks }, (_, index) => (
        <div key={index} className="skeleton__block" aria-hidden="true" />
      ))}
    </div>
  )
}

/** La pantalla entera mientras se abre la aplicación o las cuentas: la marca y el esqueleto de una página. */
export function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="loading-screen">
      <div className="loading-screen__brand" aria-hidden="true" />
      <Skeleton label={label} />
    </div>
  )
}

/**
 * Si no llega una parte de la web que se descarga aparte (lazyComponent), por ejemplo porque el servidor se ha
 * actualizado y sus archivos ya son otros: un aviso con «Volver a cargar» en lugar de una página en blanco.
 */
export class LoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="splash">
        <div className="splash__card" role="alert">
          <h1>No se ha podido abrir esta parte</h1>
          <p>Puede que la aplicación se haya actualizado o que se haya cortado la conexión. Vuelve a cargar la página.</p>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Volver a cargar
          </button>
        </div>
      </div>
    )
  }
}
