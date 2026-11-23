import { Component, useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon } from './Icon.tsx'

/**
 * Si algo falla al pintar el contenido de una ventana, se queda la ventana con
 * un aviso en lugar de quedarse la página en blanco: el resto de la app sigue
 * como estaba. React escribe el error en la consola.
 */
class DialogBoundary extends Component<{ onClose: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <>
        <div className="dialog__body">
          <DialogError message="Algo ha fallado al mostrar esta ventana. Ciérrala y vuelve a intentarlo: lo que ya estaba guardado no se ha perdido." />
        </div>
        <div className="dialog__footer">
          <button type="button" className="btn btn--primary" onClick={this.props.onClose}>
            Cerrar esta ventana
          </button>
        </div>
      </>
    )
  }
}

interface DialogProps {
  title: string
  onClose: () => void
  children: ReactNode
  /** "form": a pantalla completa en el móvil. "wide": igual, pero más ancha en el ordenador. "alert": confirmación compacta. */
  size?: 'form' | 'wide' | 'alert'
}

/**
 * Ventana modal accesible basada en <dialog> nativo: atrapa el foco, se cierra
 * con Esc y deja el resto de la página inerte. Al cerrarse devuelve el foco al
 * elemento que la abrió. El elemento con data-autofocus recibe el foco inicial.
 */
export function Dialog({ title, onClose, children, size = 'form' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog.open) dialog.showModal()
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    return () => {
      if (dialog.open) dialog.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${size}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="dialog__header">
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <DialogBoundary onClose={onClose}>{children}</DialogBoundary>
    </dialog>
  )
}

/**
 * Error al guardar, dentro de la propia ventana: lo que hay fuera de una
 * ventana modal queda inactivo y un aviso externo podría no anunciarse.
 */
export function DialogError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="notice notice--error" role="alert">
      <Icon name="alert" />
      <span>{message}</span>
    </p>
  )
}

/** Diálogo de confirmación con dos botones. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  busy = false,
  error = null,
  onConfirm,
  onClose,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog title={title} onClose={onClose} size="alert">
      <div className="dialog__body">
        {children}
        <DialogError message={error} />
      </div>
      <div className="dialog__footer">
        <button type="button" className="btn" onClick={onClose} data-autofocus>
          Cancelar
        </button>
        <button type="button" className={`btn ${danger ? 'btn--danger-solid' : 'btn--primary'}`} onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}
