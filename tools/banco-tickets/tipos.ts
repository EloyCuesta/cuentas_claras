import type { TicketSegment } from '#shared/tickets/types.ts'

/**
 * Lo que se pasan Node y la página del banco (pagina/banco.ts) por
 * `page.evaluate`: solo datos serializables, sin tipos del DOM.
 */

/** Una imagen, como la elegiría la persona: nombre, tipo MIME y bytes en base64. */
export interface ImagenBanco {
  nombre: string
  tipo: string
  base64: string
}

/** Lo que prepara el navegador: las franjas que se envían a leer, los avisos y el tiempo. */
export interface PreparadoBanco {
  franjas: TicketSegment[]
  avisos: string[]
  ms: number
  /** El mensaje de un TicketImageError (la app lo enseñaría y no leería nada). */
  error?: string
}

export interface BancoPagina {
  /** La preparación de la app (src/features/tickets/ticketImages.ts), con las opciones por defecto. */
  preparar(imagenes: ImagenBanco[]): Promise<PreparadoBanco>
  /** Reescala con canvas (suavizado alto) y codifica: así salen las copias «por WhatsApp» y las de 400 px. */
  reescalar(imagen: ImagenBanco, ancho: number, alto: number | null, tipo: string, calidad: number): Promise<string>
}
