import type { TicketSegment } from '../domain/types.ts'

export class TicketImageError extends Error {}
export interface TicketImageOptions {
  rotation: 0 | 90 | 180 | 270
  crop: { top: number; right: number; bottom: number; left: number }
  autoCrop: boolean
}
export const defaultImageOptions = (): TicketImageOptions => ({ rotation: 0, crop: { top: 0, right: 0, bottom: 0, left: 0 }, autoCrop: true })
export const MAX_SEGMENTS = 24
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024

/**
 * Una línea de ticket de Lidl tiene unos 44 caracteres de ancho. Con la
 * anchura útil de la imagen (en píxeles originales, antes de ampliarla) se
 * estima cuántos píxeles tiene cada letra. Ampliar después no recupera detalle:
 * por debajo de unos 7 px por letra el OCR confunde cifras con frecuencia.
 */
export const CHARS_PER_TICKET_LINE = 44
export type ImageQualityLevel = 'buena' | 'baja' | 'insuficiente'
export function imageQuality(usefulWidth: number): { level: ImageQualityLevel; pixelsPerChar: number; warning: string | null } {
  const pixelsPerChar = Math.round((usefulWidth / CHARS_PER_TICKET_LINE) * 10) / 10
  if (pixelsPerChar < 7) return { level: 'insuficiente', pixelsPerChar, warning:
    `La imagen tiene muy poca resolución (unos ${pixelsPerChar} px por letra): muchas cifras pueden leerse mal. Usa la captura original sin comprimir o haz la foto más cerca.` }
  if (pixelsPerChar < 11) return { level: 'baja', pixelsPerChar, warning:
    `La imagen tiene poca resolución (unos ${pixelsPerChar} px por letra): revisa los importes con la imagen. Ampliarla no recupera letras perdidas.` }
  return { level: 'buena', pixelsPerChar, warning: null }
}

/** Brillo de un píxel RGBA (0-255). */
const luminance = (d: Uint8ClampedArray, p: number) => (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000

/** Percentiles 1 y 99 del brillo, sobre una muestra de como mucho ~200 000 píxeles. */
export function luminanceRange(rgba: Uint8ClampedArray): { low: number; high: number } {
  const histogram = new Uint32Array(256)
  const pixels = rgba.length / 4
  const step = Math.max(1, Math.floor(pixels / 200_000))
  let count = 0
  for (let i = 0; i < pixels; i += step) { histogram[Math.round(luminance(rgba, i * 4))]++; count++ }
  const percentile = (q: number) => {
    let seen = 0
    for (let v = 0; v < 256; v++) { seen += histogram[v]; if (seen >= q * count) return v }
    return 255
  }
  return { low: percentile(0.01), high: percentile(0.99) }
}

/**
 * Solo vale la pena retocar una imagen de poco contraste (una foto de papel
 * grisáceo). Una captura de pantalla ya va de casi negro a blanco y no se toca:
 * en las pruebas con OCR real no mejoraba y a veces empeoraba.
 */
export const needsEnhancement = ({ low, high }: { low: number; high: number }) => high - low < 200 && high - low >= 30

/**
 * Prepara una franja para el OCR, en su sitio: escala de grises, contraste
 * estirado (low → 0, high → 255) y, si se ha ampliado, un enfoque suave
 * (máscara de desenfoque 3 × 3). La imagen original del usuario no se modifica:
 * esto solo afecta a la copia que se envía al lector.
 */
export function enhanceForOcr(rgba: Uint8ClampedArray, width: number, height: number, range: { low: number; high: number }, sharpen: boolean): void {
  // Búferes de 8 bits (no de coma flotante): una franja de 1300 × 4096 ocupa ~5 MB cada uno, no ~21 MB.
  const span = Math.max(1, range.high - range.low)
  const gray = new Uint8ClampedArray(width * height)
  for (let i = 0; i < gray.length; i++) gray[i] = (luminance(rgba, i * 4) - range.low) * 255 / span
  let out = gray
  if (sharpen) {
    out = new Uint8ClampedArray(gray.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(height - 1, Math.max(0, y + dy)) * width
          for (let dx = -1; dx <= 1; dx++) sum += gray[yy + Math.min(width - 1, Math.max(0, x + dx))]
        }
        const v = gray[y * width + x]
        out[y * width + x] = v + 0.6 * (v - sum / 9)
      }
    }
  }
  for (let i = 0; i < out.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = out[i]
    rgba[i * 4 + 3] = 255
  }
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new TicketImageError('No se ha podido abrir la imagen. Elige una captura PNG o una foto JPEG.')) }
    image.src = url
  })
}
const toBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
  reader.onerror = () => reject(new TicketImageError('No se ha podido leer la imagen.'))
  reader.readAsDataURL(blob)
})

export function imageLayout(width: number, height: number) {
  if (width <= 0 || height <= 0) throw new TicketImageError('La imagen no tiene un tamaño válido.')
  const scale = width < 1300 ? Math.min(4, 1300 / width) : width > 1800 ? 1800 / width : 1
  const outputWidth = Math.round(width * scale)
  const outputHeight = Math.round(height * scale)
  const offsets: number[] = []
  for (let y = 0; y < outputHeight; y += 4096 - 128) {
    offsets.push(y)
    if (y + 4096 >= outputHeight) break
  }
  if (offsets.length > MAX_SEGMENTS || outputHeight > 160000) throw new TicketImageError('El ticket es demasiado largo. Recorta la publicidad o elige capturas de la zona de compra.')
  return { scale, width: outputWidth, height: outputHeight, offsets }
}

/** A strip canvas never exceeds 1800 × 4096. No full-height scaled canvas. */
export async function prepareTicketImage(file: Blob, imageIndex = 0, options = defaultImageOptions()): Promise<{
  segments: TicketSegment[]; bytes: number; warnings: string[]; quality: ImageQualityLevel; enhanced: boolean
}> {
  if (!file.type.startsWith('image/')) throw new TicketImageError('Elige una imagen del ticket.')
  const image = await loadImage(file)
  if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new TicketImageError('La imagen supera 40 millones de píxeles. Elige una captura más pequeña.')
  const width = options.rotation % 180 ? image.naturalHeight : image.naturalWidth
  const height = options.rotation % 180 ? image.naturalWidth : image.naturalHeight
  const { crop } = options
  if (Object.values(crop).some(n => !Number.isFinite(n) || n < 0 || n > 90) || crop.left + crop.right >= 95 || crop.top + crop.bottom >= 95) throw new TicketImageError('El recorte debe conservar una zona legible del ticket.')
  const drawRotated = (ctx: CanvasRenderingContext2D) => {
    if (options.rotation === 90) { ctx.translate(width, 0); ctx.rotate(Math.PI / 2) }
    if (options.rotation === 180) { ctx.translate(width, height); ctx.rotate(Math.PI) }
    if (options.rotation === 270) { ctx.translate(0, height); ctx.rotate(-Math.PI / 2) }
    ctx.drawImage(image, 0, 0)
  }
  let left = Math.floor(width * crop.left / 100)
  let top = Math.floor(height * crop.top / 100)
  let right = Math.ceil(width * (1 - crop.right / 100))
  let bottom = Math.ceil(height * (1 - crop.bottom / 100))
  // Una copia pequeña de la imagen: para quitar márgenes blancos y medir el contraste.
  let range: { low: number; high: number } | null = null
  {
    const probe = document.createElement('canvas')
    const ratio = Math.min(1, 320 / width, 1200 / height)
    probe.width = Math.max(1, Math.round(width * ratio)); probe.height = Math.max(1, Math.round(height * ratio))
    const ctx = probe.getContext('2d', { willReadFrequently: true })
    if (ctx) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, probe.width, probe.height)
      ctx.scale(ratio, ratio); drawRotated(ctx)
      const data = ctx.getImageData(0, 0, probe.width, probe.height).data
      range = luminanceRange(data)
      const white = (x: number, y: number) => { const p = (y * probe.width + x) * 4; return data[p] >= 250 && data[p + 1] >= 250 && data[p + 2] >= 250 }
      let x0 = 0, x1 = probe.width - 1, y0 = 0, y1 = probe.height - 1
      if (options.autoCrop) {
        while (x0 < probe.width / 4 && Array.from({ length: probe.height }, (_, y) => white(x0, y)).every(Boolean)) x0++
        while (x1 > probe.width * 3 / 4 && Array.from({ length: probe.height }, (_, y) => white(x1, y)).every(Boolean)) x1--
        while (y0 < probe.height / 4 && Array.from({ length: probe.width }, (_, x) => white(x, y0)).every(Boolean)) y0++
        while (y1 > probe.height * 3 / 4 && Array.from({ length: probe.width }, (_, x) => white(x, y1)).every(Boolean)) y1--
        const margin = 12 / ratio
        left = Math.max(left, Math.floor(x0 / ratio - margin)); right = Math.min(right, Math.ceil((x1 + 1) / ratio + margin))
        top = Math.max(top, Math.floor(y0 / ratio - margin)); bottom = Math.min(bottom, Math.ceil((y1 + 1) / ratio + margin))
      }
    }
    probe.width = probe.height = 1
  }
  const layout = imageLayout(right - left, bottom - top)
  const warnings: string[] = []
  const quality = imageQuality(right - left)
  if (quality.warning) warnings.push(quality.warning)
  const enhance = range !== null && needsEnhancement(range)
  if (width > height * 1.5) warnings.push('La imagen es horizontal. Si el texto está girado, vuelve atrás y gira la foto antes de leer.')
  const segments: TicketSegment[] = []
  let bytes = 0
  for (const [segmentIndex, offsetY] of layout.offsets.entries()) {
    const canvas = document.createElement('canvas')
    canvas.width = layout.width; canvas.height = Math.min(4096, layout.height - offsetY)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new TicketImageError('Este navegador no puede preparar la imagen.')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
    ctx.translate(0, -offsetY); ctx.scale(layout.scale, layout.scale); ctx.translate(-left, -top)
    drawRotated(ctx)
    if (enhance) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
      enhanceForOcr(pixels.data, canvas.width, canvas.height, range!, layout.scale > 1.3)
      ctx.putImageData(pixels, 0, 0)
    }
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob) throw new TicketImageError('No se ha podido preparar una franja del ticket.')
    bytes += blob.size
    if (blob.size > 8 * 1024 * 1024 || bytes > MAX_TOTAL_BYTES) throw new TicketImageError('Las imágenes son demasiado grandes. Recorta los márgenes y la publicidad.')
    segments.push({ image: await toBase64(blob), imageIndex, segmentIndex, offsetY, fullHeight: layout.height })
    canvas.width = canvas.height = 1
  }
  return { segments, bytes, warnings, quality: quality.level, enhanced: enhance }
}