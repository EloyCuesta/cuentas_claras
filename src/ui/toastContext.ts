import { createContext, useContext } from 'react'

/** «warning»: algo salió a medias pero no hay que repetirlo (por ejemplo, guardado y sin poder recargar la pantalla). */
export type ToastTone = 'success' | 'warning' | 'error'

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
