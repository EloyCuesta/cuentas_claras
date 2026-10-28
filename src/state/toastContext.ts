import { createContext, useContext } from 'react'

export type ToastTone = 'success' | 'error'

export interface ToastApi {
  /** Muestra un aviso breve (se anuncia también a los lectores de pantalla). */
  notify(message: string, tone?: ToastTone): void
}

export const ToastContext = createContext<ToastApi>({ notify: () => undefined })

export function useToast(): ToastApi {
  return useContext(ToastContext)
}
