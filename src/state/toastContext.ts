import { createContext, useContext } from 'react'

export type ToastTone = 'success' | 'error'

export interface ToastOptions {
  /** Botón dentro del aviso, por ejemplo «Deshacer». Al pulsarlo el aviso se cierra. */
  action?: { label: string; onAction: () => void }
}

export interface ToastApi {
  /** Muestra un aviso breve (se anuncia también a los lectores de pantalla). */
  notify(message: string, tone?: ToastTone, options?: ToastOptions): void
}

export const ToastContext = createContext<ToastApi>({ notify: () => undefined })

export function useToast(): ToastApi {
  return useContext(ToastContext)
}
