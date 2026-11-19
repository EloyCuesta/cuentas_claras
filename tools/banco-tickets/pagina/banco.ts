import { defaultImageOptions, prepareTicketImages, TicketImageError } from '../../../src/features/tickets/ticketImages.ts'
import type { BancoPagina, ImagenBanco } from '../tipos.ts'

/**
 * La página del banco: la carga medir.ts (y generar.ts) en Chrome con Vite y
 * la llama por `globalThis.banco`. Prepara las imágenes con la misma función que
 * la revisión de la app, así el banco mide exactamente lo que se envía a leer.
 */

const blobOf = (imagen: ImagenBanco) => new Blob([Uint8Array.from(atob(imagen.base64), (c) => c.charCodeAt(0))], { type: imagen.tipo })

const base64Of = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
  reader.onerror = () => reject(new Error('No se ha podido leer la imagen reescalada'))
  reader.readAsDataURL(blob)
})

const banco: BancoPagina = {
  async preparar(imagenes) {
    const inicio = performance.now()
    try {
      const { segments, warnings } = await prepareTicketImages(imagenes.map((imagen) => ({ file: blobOf(imagen), options: defaultImageOptions() })))
      return { franjas: segments, avisos: warnings, ms: performance.now() - inicio }
    } catch (error) {
      if (error instanceof TicketImageError) return { franjas: [], avisos: [], ms: performance.now() - inicio, error: error.message }
      throw error
    }
  },

  async reescalar(imagen, ancho, alto, tipo, calidad) {
    const bitmap = await createImageBitmap(blobOf(imagen))
    const canvas = document.createElement('canvas')
    canvas.width = ancho
    canvas.height = alto ?? Math.round(bitmap.height * ancho / bitmap.width)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, tipo, calidad))
    if (!blob) throw new Error('No se ha podido codificar la imagen reescalada')
    return base64Of(blob)
  },
}

;(globalThis as unknown as { banco: BancoPagina }).banco = banco
