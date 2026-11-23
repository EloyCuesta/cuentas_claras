import type { TicketSegment } from '#shared/tickets/types.ts'
import {
  contentBox, cropGray, findOverlap, findPaper, fixedBands, grayFromRgba, invertGray, isScreenImage, measureTextHeight, orderCaptures,
  OVERLAP_MAX_SCORE, overlapUsable, paperTone, scaleForTextHeight, type Box, type GrayImage, type Overlap,
} from './ticketImageAnalysis.ts'

/**
 * Preparar en el navegador las imágenes de un ticket antes de leerlas. La
 * imagen original no se toca: esto es la copia que se envía al servidor.
 *
 * 1. Cada imagen se gira y se recorta si se pide, y se analiza una copia en
 *    gris (ticketImageAnalysis.ts): el tono del papel, dónde está el papel y la
 *    altura de las letras. El giro se aplica al dibujar cada copia (drawRotated),
 *    nunca en un lienzo del tamaño de la foto, y cada lienzo se libera al acabar.
 * 2. Varias capturas del mismo ticket se unen en una sola imagen: se quitan las
 *    bandas fijas (barra de estado, cabecera, navegación), se busca cuánto se
 *    desplaza cada una respecto a la anterior y se pega solo lo nuevo. Si dos no
 *    se solapan con claridad no se inventa nada: se avisa y van por separado.
 * 3. Se recorta al papel escrito y se escala para que las mayúsculas midan lo
 *    que mejor lee el OCR (ver TARGET_TEXT_HEIGHT y el banco de medida), no por
 *    el ancho: a más de unos 24 px Tesseract pierde la columna de importes.
 * 4. Se divide en franjas de como mucho 4096 px de alto que se solapan, se
 *    invierte si el texto era claro sobre fondo oscuro, y solo en las fotos de
 *    poco contraste se estira el contraste y se enfoca. Las imágenes de pantalla
 *    van en PNG; las fotos, en JPEG.
 */

export class TicketImageError extends Error {}
export interface TicketImageOptions {
  rotation: 0 | 90 | 180 | 270
  crop: { top: number; right: number; bottom: number; left: number }
  autoCrop: boolean
}
export const defaultImageOptions = (): TicketImageOptions => ({ rotation: 0, crop: { top: 0, right: 0, bottom: 0, left: 0 }, autoCrop: true })
export const MAX_SEGMENTS = 24
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024
const MAX_SEGMENT_BYTES = 8 * 1024 * 1024
const STRIP_HEIGHT = 4096
const STRIP_OVERLAP = 128
/** La copia que se analiza: como mucho 1600 px de ancho y 16 millones de píxeles (lo que admite un móvil). */
const ANALYSIS_WIDTH = 1600
const ANALYSIS_PIXELS = 16_000_000
const MAX_OUTPUT_WIDTH = 2400

/**
 * Una línea de ticket de Lidl tiene unos 44 caracteres de ancho. Con la
 * anchura útil de la imagen (en píxeles originales, antes de ampliarla) se
 * estima cuántos píxeles tiene cada letra. Ampliar después no recupera detalle:
 * por debajo de unos 7 px por letra el OCR confunde cifras con frecuencia.
 * Solo se usa si no se puede medir la altura de las letras (textQuality).
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

/**
 * Lo mismo, con la altura de las mayúsculas medida en la imagen original
 * (una mayúscula mide unas 1,15 veces el ancho de una letra).
 */
export function textQuality(textHeight: number): { level: ImageQualityLevel; warning: string | null } {
  const px = Math.round(textHeight)
  if (textHeight < 8) return { level: 'insuficiente', warning:
    `La imagen tiene muy poca resolución (letras de unos ${px} px de alto): muchas cifras pueden leerse mal. Usa la captura original sin comprimir o haz la foto más cerca.` }
  if (textHeight < 12.5) return { level: 'baja', warning:
    `La imagen tiene poca resolución (letras de unos ${px} px de alto): revisa los importes con la imagen. Ampliarla no recupera letras perdidas.` }
  return { level: 'buena', warning: null }
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

/** Texto claro sobre fondo oscuro → texto oscuro sobre fondo claro, en su sitio. */
export function invertRgba(rgba: Uint8ClampedArray): void {
  for (let p = 0; p < rgba.length; p += 4) {
    rgba[p] = 255 - rgba[p]
    rgba[p + 1] = 255 - rgba[p + 1]
    rgba[p + 2] = 255 - rgba[p + 2]
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

/** Las franjas de una imagen de `height` px: 4096 de alto, solapadas 128. */
function stripOffsets(height: number): number[] {
  const offsets: number[] = []
  for (let y = 0; y < height; y += STRIP_HEIGHT - STRIP_OVERLAP) {
    offsets.push(y)
    if (y + STRIP_HEIGHT >= height) break
  }
  return offsets
}

/**
 * La escala de antes, por el ancho (1300-1800 px): solo si no se puede medir la
 * altura de las letras (una imagen sin renglones claros).
 */
export function imageLayout(width: number, height: number) {
  if (width <= 0 || height <= 0) throw new TicketImageError('La imagen no tiene un tamaño válido.')
  const scale = width < 1300 ? Math.min(4, 1300 / width) : width > 1800 ? 1800 / width : 1
  const outputWidth = Math.round(width * scale)
  const outputHeight = Math.round(height * scale)
  const offsets = stripOffsets(outputHeight)
  if (offsets.length > MAX_SEGMENTS || outputHeight > 160000) throw new TicketImageError('El ticket es demasiado largo. Recorta la publicidad o elige capturas de la zona de compra.')
  return { scale, width: outputWidth, height: outputHeight, offsets }
}

/** Un rectángulo en píxeles (x, y, ancho y alto). */
export interface PixelRect { x: number; y: number; width: number; height: number }

/**
 * El trozo de la imagen original (`naturalWidth` × `naturalHeight`) que se ve
 * en `rect` cuando la imagen se gira `rotation` grados en el sentido de las
 * agujas del reloj (90 y 270 intercambian el ancho y el alto).
 */
export function rotatedSourceRect(rotation: TicketImageOptions['rotation'], naturalWidth: number, naturalHeight: number, rect: PixelRect): PixelRect {
  const { x, y, width, height } = rect
  if (rotation === 90) return { x: y, y: naturalHeight - x - width, width: height, height: width }
  if (rotation === 180) return { x: naturalWidth - x - width, y: naturalHeight - y - height, width, height }
  if (rotation === 270) return { x: naturalWidth - y - height, y: x, width: height, height: width }
  return rect
}

/**
 * Dibuja en `ctx`, en el destino (dx, dy, dw, dh), el trozo `rect` de la imagen
 * girada. El giro va en la transformación del lienzo: nunca se crea un lienzo
 * del tamaño de la imagen girada (una foto de 24 MP no cabe en el de Safari).
 * Sin giro es el mismo drawImage de siempre.
 */
function drawRotated(ctx: CanvasRenderingContext2D, image: HTMLImageElement, rotation: TicketImageOptions['rotation'], rect: PixelRect,
  dx: number, dy: number, dw: number, dh: number): void {
  if (rotation === 0) {
    ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, dx, dy, dw, dh)
    return
  }
  const source = rotatedSourceRect(rotation, image.naturalWidth, image.naturalHeight, rect)
  ctx.save()
  try {
    // En unidades del trozo girado, con el origen en su esquina; después se gira alrededor del trozo.
    ctx.translate(dx, dy)
    ctx.scale(dw / rect.width, dh / rect.height)
    if (rotation === 90) { ctx.translate(rect.width, 0); ctx.rotate(Math.PI / 2) }
    if (rotation === 180) { ctx.translate(rect.width, rect.height); ctx.rotate(Math.PI) }
    if (rotation === 270) { ctx.translate(0, rect.height); ctx.rotate(-Math.PI / 2) }
    ctx.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, source.width, source.height)
  } finally {
    ctx.restore()
  }
}

/** Un lienzo de trabajo que se libera siempre al terminar, también si algo falla. */
async function withCanvas<T>(width: number, height: number, draw: (canvas: HTMLCanvasElement) => T | Promise<T>): Promise<T> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  try {
    return await draw(canvas)
  } finally {
    canvas.width = canvas.height = 0
  }
}

/** Una imagen elegida, girada, recortada a mano si se pidió y con su copia de análisis. */
interface Source {
  /** La imagen original, sin girar: el giro se aplica al dibujarla (drawRotated). */
  image: HTMLImageElement
  rotation: TicketImageOptions['rotation']
  /** Lo que se usa de la imagen original, ya girada (en sus píxeles). */
  crop: Box
  /** Píxeles de la copia de análisis por píxel original. */
  factor: number
  gray: GrayImage
  tone: number
  dark: boolean
  range: { low: number; high: number }
  autoCrop: boolean
}

async function decode(file: Blob, options: TicketImageOptions): Promise<Source> {
  if (!file.type.startsWith('image/')) throw new TicketImageError('Elige una imagen del ticket.')
  const image = await loadImage(file)
  if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new TicketImageError('La imagen supera 40 millones de píxeles. Elige una captura más pequeña.')
  const width = options.rotation % 180 ? image.naturalHeight : image.naturalWidth
  const height = options.rotation % 180 ? image.naturalWidth : image.naturalHeight
  const { crop } = options
  if (Object.values(crop).some(n => !Number.isFinite(n) || n < 0 || n > 90) || crop.left + crop.right >= 95 || crop.top + crop.bottom >= 95) throw new TicketImageError('El recorte debe conservar una zona legible del ticket.')
  const box: Box = {
    left: Math.floor(width * crop.left / 100), top: Math.floor(height * crop.top / 100),
    right: Math.ceil(width * (1 - crop.right / 100)), bottom: Math.ceil(height * (1 - crop.bottom / 100)),
  }
  const cropWidth = box.right - box.left
  const cropHeight = box.bottom - box.top
  const factor = Math.min(1, ANALYSIS_WIDTH / cropWidth, Math.sqrt(ANALYSIS_PIXELS / (cropWidth * cropHeight)))
  // La copia de análisis, ya girada y reducida: como mucho 16 millones de píxeles.
  const { rgba, analysisWidth, analysisHeight } = await withCanvas(Math.max(1, Math.round(cropWidth * factor)), Math.max(1, Math.round(cropHeight * factor)), (canvas) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new TicketImageError('Este navegador no puede preparar la imagen.')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
    drawRotated(ctx, image, options.rotation, { x: box.left, y: box.top, width: cropWidth, height: cropHeight }, 0, 0, canvas.width, canvas.height)
    return { rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data, analysisWidth: canvas.width, analysisHeight: canvas.height }
  })
  const range = luminanceRange(rgba)
  let gray = grayFromRgba(rgba, analysisWidth, analysisHeight)
  const { tone, dark } = paperTone(gray)
  if (dark) gray = invertGray(gray)
  return { image, rotation: options.rotation, crop: box, factor, gray, tone, dark, range, autoCrop: options.autoCrop }
}

/** Un trozo de una imagen elegida dentro de una imagen unida: sus filas (en la copia de análisis) y dónde van. */
interface Piece { source: number; top: number; bottom: number; y: number }

/** Una imagen que se envía a leer: una o varias capturas unidas, en coordenadas de la copia de análisis. */
interface Group {
  sources: number[]
  pieces: Piece[]
  left: number
  right: number
  height: number
}

interface Plan { groups: Group[]; warnings: string[] }

/** Une las capturas que se solapan y avisa de las que no. Las imágenes de distinto tamaño (fotos sueltas) van por separado. */
function plan(sources: readonly Source[]): Plan {
  const warnings: string[] = []
  const sameSize = sources.length > 1 && sources.every((s) => s.gray.width === sources[0].gray.width && s.gray.height === sources[0].gray.height)
  const bands = sameSize ? fixedBands(sources.map((s) => s.gray)) : { top: 0, bottom: 0 }
  const papers = sources.map((source) => {
    const region: Box = { left: 0, top: bands.top, right: source.gray.width, bottom: source.gray.height - bands.bottom }
    if (!source.autoCrop) return region
    const paper = findPaper(cropGray(source.gray, region), source.tone)
    return paper ? { left: paper.left, right: paper.right, top: paper.top + region.top, bottom: paper.bottom + region.top } : region
  })
  // Para comparar capturas, el mismo ancho en todas: el del papel de la primera, si todas lo tienen parecido.
  const stitchable = sameSize && papers.every((p) => Math.abs(p.left - papers[0].left) <= 4 && Math.abs(p.right - papers[0].right) <= 4)
  const columns = stitchable ? { left: Math.max(...papers.map((p) => p.left)), right: Math.min(...papers.map((p) => p.right)) } : null
  const contents = sources.map((source, i) => cropGray(source.gray, columns ? { ...columns, top: papers[i].top, bottom: papers[i].bottom } : papers[i]))
  const overlaps = new Map<string, Overlap | null>()
  const overlap = (i: number, j: number) => {
    const key = `${i}-${j}`
    if (!overlaps.has(key)) overlaps.set(key, findOverlap(contents[i], contents[j], sources[i].tone))
    return overlaps.get(key)!
  }
  const order = stitchable ? orderCaptures(sources.length, (i, j) => overlapUsable(overlap(i, j))) : sources.map((_, i) => i)
  const groups: Group[] = []
  const single = (i: number): Group => ({ sources: [i], pieces: [{ source: i, top: papers[i].top, bottom: papers[i].bottom, y: 0 }],
    left: columns?.left ?? papers[i].left, right: columns?.right ?? papers[i].right, height: papers[i].bottom - papers[i].top })
  let current = single(order[0])
  for (let k = 1; k < order.length; k++) {
    const [previous, next] = [order[k - 1], order[k]]
    const found = stitchable ? overlap(previous, next) : null
    if (found && overlapUsable(found)) {
      // Lo nuevo de la siguiente empieza en la mitad del solape: ahí las dos tienen renglones enteros.
      const last = current.pieces.at(-1)!
      const lastStart = last.y - (last.top - papers[previous].top)
      const cut = Math.floor((contents[previous].height - found.offset) / 2)
      last.bottom = papers[previous].top + found.offset + cut
      const y = lastStart + found.offset
      current.pieces.push({ source: next, top: papers[next].top + cut, bottom: papers[next].bottom, y: y + cut })
      current.sources.push(next)
      current.height = y + contents[next].height
      continue
    }
    if (stitchable) {
      warnings.push(found && found.score <= OVERLAP_MAX_SCORE && found.ambiguous
        ? `No está claro dónde se solapan las capturas ${previous + 1} y ${next + 1}: se leen por separado, revisa si hay productos repetidos o que falten.`
        : `Las capturas ${previous + 1} y ${next + 1} no se solapan: puede faltar una parte del ticket.`)
    }
    groups.push(current)
    current = single(next)
  }
  groups.push(current)
  return { groups, warnings }
}

/** La copia de análisis de una imagen unida (para medir lo escrito y las letras). */
function groupGray(group: Group, sources: readonly Source[]): GrayImage {
  const width = group.right - group.left
  const data = new Uint8Array(width * group.height).fill(sources[group.sources[0]].tone)
  for (const piece of group.pieces) {
    const source = sources[piece.source].gray
    for (let row = piece.top; row < piece.bottom; row++) {
      const y = piece.y + row - piece.top
      if (y < 0 || y >= group.height) continue
      data.set(source.data.subarray(row * source.width + group.left, row * source.width + group.right), y * width)
    }
  }
  return { width, height: group.height, data }
}

export type TicketImageStep =
  | { kind: 'preparando'; image: number; total: number }
  | { kind: 'uniendo'; total: number }

export interface TicketImagesAnalysis {
  warnings: string[]
  /** Cuántas imágenes se enviarán (las capturas que se solapan se unen en una). */
  images: number
}

async function decodeAll(selections: readonly { file: Blob; options: TicketImageOptions }[], onStep?: (step: TicketImageStep) => void) {
  const sources: Source[] = []
  for (const [i, selection] of selections.entries()) {
    onStep?.({ kind: 'preparando', image: i + 1, total: selections.length })
    sources.push(await decode(selection.file, selection.options))
  }
  if (selections.length > 1) onStep?.({ kind: 'uniendo', total: selections.length })
  return sources
}

/** Lo que se sabe antes de leer: si las capturas se solapan y cuántas imágenes saldrán. */
export async function analyzeTicketImages(selections: readonly { file: Blob; options: TicketImageOptions }[]): Promise<TicketImagesAnalysis> {
  if (selections.length === 0) return { warnings: [], images: 0 }
  const { groups, warnings } = plan(await decodeAll(selections))
  return { warnings, images: groups.length }
}

/**
 * Prepara todas las imágenes elegidas de un ticket tal como se envían a leer
 * (las capturas que se solapan, unidas). La usan la revisión y el banco de
 * medida (`tools/banco-tickets/`), para medir exactamente lo que hace la app.
 */
export async function prepareTicketImages(selections: readonly { file: Blob; options: TicketImageOptions }[], onStep?: (step: TicketImageStep) => void): Promise<{
  segments: TicketSegment[]; warnings: string[]
}> {
  const sources = await decodeAll(selections, onStep)
  const { groups, warnings } = plan(sources)
  for (const source of sources) {
    const width = source.crop.right - source.crop.left
    const height = source.crop.bottom - source.crop.top
    if (width > height * 1.5) warnings.push('La imagen es horizontal. Si el texto está girado, vuelve atrás y gira la foto antes de leer.')
  }
  const segments: TicketSegment[] = []
  let bytes = 0
  for (const [imageIndex, group] of groups.entries()) {
    const sourcesOf = group.sources.map((i) => sources[i])
    const { factor, dark, tone } = sourcesOf[0]
    const gray = groupGray(group, sources)
    const whole: Box = { left: 0, top: 0, right: gray.width, bottom: gray.height }
    const textHeight = measureTextHeight(gray, whole, tone)
    const content = contentBox(gray, whole, tone, Math.max(8, Math.round(textHeight ?? 12)))
    const screen = isScreenImage(gray, content, tone)
    // De la copia de análisis a la imagen original, y de ahí a la que se envía.
    const originalWidth = (content.right - content.left) / factor
    const originalHeight = (content.bottom - content.top) / factor
    let scale: number
    if (textHeight !== null) {
      const quality = textQuality(textHeight / factor)
      if (quality.warning) warnings.push(quality.warning)
      scale = Math.min(scaleForTextHeight(textHeight / factor), MAX_OUTPUT_WIDTH / originalWidth)
    } else {
      const quality = imageQuality(originalWidth)
      if (quality.warning) warnings.push(quality.warning)
      scale = imageLayout(originalWidth, originalHeight).scale
    }
    const outputWidth = Math.max(1, Math.round(originalWidth * scale))
    const outputHeight = Math.max(1, Math.round(originalHeight * scale))
    const offsets = stripOffsets(outputHeight)
    if (offsets.length + segments.length > MAX_SEGMENTS || outputHeight > 160000) throw new TicketImageError('El ticket es demasiado largo. Recorta la publicidad o elige capturas de la zona de compra.')
    const enhance = !screen && !dark && needsEnhancement(sourcesOf[0].range)
    for (const [segmentIndex, offsetY] of offsets.entries()) {
      const blob = await withCanvas(outputWidth, Math.min(STRIP_HEIGHT, outputHeight - offsetY), async (canvas) => {
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new TicketImageError('Este navegador no puede preparar la imagen.')
        ctx.fillStyle = dark ? '#000' : '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
        // Copia de análisis → imagen enviada: (y - content.top) / factor × scale.
        const toOutput = scale / factor
        for (const piece of group.pieces) {
          const from = Math.max(piece.y, content.top)
          const to = Math.min(piece.y + piece.bottom - piece.top, content.bottom)
          const dy0 = (from - content.top) * toOutput - offsetY
          const dy1 = (to - content.top) * toOutput - offsetY
          if (to <= from || dy1 <= 0 || dy0 >= canvas.height) continue
          const source = sources[piece.source]
          const sy = (piece.top + from - piece.y) / factor
          drawRotated(ctx, source.image, source.rotation,
            { x: source.crop.left + (group.left + content.left) / factor, y: source.crop.top + sy, width: originalWidth, height: (to - from) / factor },
            0, dy0, outputWidth, dy1 - dy0)
        }
        if (dark || enhance) {
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
          if (dark) invertRgba(pixels.data)
          else enhanceForOcr(pixels.data, canvas.width, canvas.height, sourcesOf[0].range, scale > 1.3)
          ctx.putImageData(pixels, 0, 0)
        }
        let blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, screen ? 'image/png' : 'image/jpeg', 0.92))
        // Una franja de pantalla que no cabe en PNG va en JPEG.
        if (blob && screen && (blob.size > MAX_SEGMENT_BYTES || bytes + blob.size > MAX_TOTAL_BYTES)) blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
        return blob
      })
      if (!blob) throw new TicketImageError('No se ha podido preparar una franja del ticket.')
      bytes += blob.size
      if (blob.size > MAX_SEGMENT_BYTES || bytes > MAX_TOTAL_BYTES) throw new TicketImageError('Las imágenes son demasiado grandes. Recorta los márgenes y la publicidad.')
      segments.push({ image: await toBase64(blob), imageIndex, segmentIndex, offsetY, fullHeight: outputHeight })
    }
  }
  if (segments.length > MAX_SEGMENTS || bytes > MAX_TOTAL_BYTES) throw new TicketImageError('El conjunto supera 24 franjas o 20 MB. Recorta las zonas informativas antes de leer.')
  return { segments, warnings: [...new Set(warnings)] }
}
