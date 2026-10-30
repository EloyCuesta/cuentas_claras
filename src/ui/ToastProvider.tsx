import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon.tsx'
import { ToastContext, type ToastApi, type ToastTone } from './toastContext.ts'

interface Toast {
  id: number
  message: string
  tone: ToastTone
  action?: { label: string; onAction: () => void }
}

/** Con un botón («Deshacer») el aviso dura más, para que dé tiempo a pulsarlo. */
const ACTION_MS = 12_000

/** Avisos breves ("Gasto guardado") en una región que los lectores de pantalla anuncian. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  const api = useMemo<ToastApi>(
    () => ({
      notify(message, tone = 'success', options = {}) {
        const id = nextId.current++
        setToasts((list) => [...list.slice(-2), { id, message, tone, action: options.action }])
        window.setTimeout(() => dismiss(id), options.action ? ACTION_MS : tone === 'error' ? 8000 : 4000)
      },
    }),
    [dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            <Icon name={toast.tone === 'error' ? 'alert' : 'check'} />
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  dismiss(toast.id)
                  toast.action?.onAction()
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button type="button" className="toast__close" aria-label="Cerrar aviso" onClick={() => dismiss(toast.id)}>
              <Icon name="close" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
