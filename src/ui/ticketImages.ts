/**
 * Prepara las capturas o fotos de un ticket antes de enviarlas al lector:
 * - Las pequeñas (por ejemplo, una captura reenviada por WhatsApp) se agrandan
 *   hasta unos 1300 px de ancho: el OCR lee mucho mejor las cifras.
 * - Las muy grandes se reducen, para que lean antes y quepan en la petición.
 * - Se convierten a JPEG con fondo blanco.
 * Funciona también por HTTP en la red de casa (no necesita contexto seguro).
 */

const TARGET_WIDTH = 1300
const MAX_WIDTH = 1800
const MAX_UPSCALE = 4
/** Límite de píxeles de un canvas en Safari (iOS). */
const MAX_PIXELS = 16_000_000

export class TicketImageError extends Error {}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new TicketImageError('No se ha podido abrir la imagen. ¿Es una foto o una captura?'))
    }
    image.src = url
  })
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(new TicketImageError('No se ha podido leer la imagen.'))
    reader.readAsDataURL(blob)
  })
}

export async function prepareTicketImage(file: Blob): Promise<string> {
  if (!file.type.startsWith('image/')) throw new TicketImageError('Elige una imagen (captura o foto del ticket).')
  const image = await loadImage(file)
  let scale = 1
  if (image.naturalWidth < TARGET_WIDTH) scale = Math.min(MAX_UPSCALE, TARGET_WIDTH / image.naturalWidth)
  else if (image.naturalWidth > MAX_WIDTH) scale = MAX_WIDTH / image.naturalWidth
  let width = Math.round(image.naturalWidth * scale)
  let height = Math.round(image.naturalHeight * scale)
  if (width * height > MAX_PIXELS) {
    const shrink = Math.sqrt(MAX_PIXELS / (width * height))
    width = Math.floor(width * shrink)
    height = Math.floor(height * shrink)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new TicketImageError('Este navegador no puede preparar la imagen.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!blob) throw new TicketImageError('No se ha podido preparar la imagen.')
  return toBase64(blob)
}
