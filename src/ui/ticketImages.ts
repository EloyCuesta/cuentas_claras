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
export async function prepareTicketImage(file: Blob, imageIndex = 0, options = defaultImageOptions()): Promise<{ segments: TicketSegment[]; bytes: number; warnings: string[] }> {
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
  if (options.autoCrop) {
    // Low-resolution probe only removes uniformly white outer margins.
    const probe = document.createElement('canvas')
    const ratio = Math.min(1, 320 / width, 1200 / height)
    probe.width = Math.max(1, Math.round(width * ratio)); probe.height = Math.max(1, Math.round(height * ratio))
    const ctx = probe.getContext('2d', { willReadFrequently: true })
    if (ctx) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, probe.width, probe.height)
      ctx.scale(ratio, ratio); drawRotated(ctx)
      const data = ctx.getImageData(0, 0, probe.width, probe.height).data
      const white = (x: number, y: number) => { const p = (y * probe.width + x) * 4; return data[p] >= 250 && data[p + 1] >= 250 && data[p + 2] >= 250 }
      let x0 = 0, x1 = probe.width - 1, y0 = 0, y1 = probe.height - 1
      while (x0 < probe.width / 4 && Array.from({ length: probe.height }, (_, y) => white(x0, y)).every(Boolean)) x0++
      while (x1 > probe.width * 3 / 4 && Array.from({ length: probe.height }, (_, y) => white(x1, y)).every(Boolean)) x1--
      while (y0 < probe.height / 4 && Array.from({ length: probe.width }, (_, x) => white(x, y0)).every(Boolean)) y0++
      while (y1 > probe.height * 3 / 4 && Array.from({ length: probe.width }, (_, x) => white(x, y1)).every(Boolean)) y1--
      const margin = 12 / ratio
      left = Math.max(left, Math.floor(x0 / ratio - margin)); right = Math.min(right, Math.ceil((x1 + 1) / ratio + margin))
      top = Math.max(top, Math.floor(y0 / ratio - margin)); bottom = Math.min(bottom, Math.ceil((y1 + 1) / ratio + margin))
    }
    probe.width = probe.height = 1
  }
  const layout = imageLayout(right - left, bottom - top)
  const warnings: string[] = []
  if (right - left < 450) warnings.push('La captura es estrecha: ampliarla no recupera letras perdidas. Si hay dudas, usa la captura original sin comprimir.')
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
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob) throw new TicketImageError('No se ha podido preparar una franja del ticket.')
    bytes += blob.size
    if (blob.size > 8 * 1024 * 1024 || bytes > MAX_TOTAL_BYTES) throw new TicketImageError('Las imágenes son demasiado grandes. Recorta los márgenes y la publicidad.')
    segments.push({ image: await toBase64(blob), imageIndex, segmentIndex, offsetY, fullHeight: layout.height })
    canvas.width = canvas.height = 1
  }
  return { segments, bytes, warnings }
}