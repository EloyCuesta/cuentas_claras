import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createWorker, OEM, PSM, type Line, type Word, type Worker } from 'tesseract.js'
import type { OcrLine, TicketSegment } from '#shared/tickets/types.ts'
import { endsProducts } from '#shared/tickets/ticketParse.ts'
import { imageInfo, type ImageInfo } from '../../../../common/imageInfo.ts'
import type { TicketReader } from '../../application/ports.ts'
import { amountBand, type Band } from './amountColumn.ts'
import { decodePngGray, encodeGrayPng, scaleRegion } from './pngImage.ts'

/**
 * Lector de tickets: OCR con Tesseract (tesseract.js), en este mismo equipo.
 * Las imágenes no salen de casa y no se descarga nada al usarlo: el modelo de
 * español viene en node_modules (@tesseract.js-data/spa).
 *
 * Dos pasadas por imagen (todas las franjas de una misma imagen juntas):
 * 1. Texto completo, línea a línea (nombres, fechas, total…), en modo «una
 *    columna» (PSM 4): un ticket es una sola columna de texto de distintos
 *    tamaños. Medido con OCR real sobre 132 líneas de tickets de prueba (capturas
 *    a 400-1080 px y fotos): 111 líneas limpias frente a 104 con PSM 6 (bloque),
 *    sin ningún importe erróneo aceptado en silencio en ninguno de los dos.
 * 2. La banda de importes (cantidad × precio, importe y letra de IVA) de cada
 *    línea de producto, leída otra vez con una lista de caracteres permitidos
 *    (cifras, coma, x, A/B/C). La banda se calcula con todas las líneas de la
 *    imagen (amountColumn.ts), no con las palabras de cada línea: así se relee
 *    aunque Tesseract no haya devuelto la columna de importes en esa línea (la
 *    pierde si la separa como otro bloque) y la relectura nunca lee el nombre.
 *    Se relee en todas las líneas de producto, no solo en las dudosas. Si no hay
 *    una columna de importes clara (otro formato de ticket), se relee como
 *    antes el final numérico de las líneas que lo necesitan.
 *    Leer solo la palabra del importe (PSM 8) o quitar la lista de caracteres
 *    dieron peores resultados en la medición.
 *    Sin banda, si la relectura del final no trae nada con forma de importe
 *    («1» por «0,15 C»), se repite una vez con un margen más ajustado (ver
 *    TAIL_RETRY_PAD).
 * Las dos lecturas se entregan al analizador (shared/tickets/ticketParse.ts), que
 * las compara entre sí y con la multiplicación de la línea. El total del
 * ticket nunca decide un importe.
 *
 * Un solo «worker» para todas las peticiones, de una en una. Se cierra tras
 * unos minutos sin uso para liberar memoria y se vuelve a abrir al necesitarlo.
 */

const require = createRequire(import.meta.url)
const LANG_PATH = join(dirname(require.resolve('@tesseract.js-data/spa/package.json')), '4.0.0_best_int')

/** Caracteres de la parte final de una línea de producto: «3,95x 2 7,90 B». */
const TAIL_WHITELIST = '0123456789,.-xX ABC'
/** Caracteres de una línea de peso: «0,544 kg x 6,75 EUR/kg». */
const WEIGHT_WHITELIST = '0123456789,.kgxEUR/ '
/** Margen alrededor de lo que se relee, en proporción al alto de la línea. */
const TAIL_PAD = 0.35
/**
 * Margen de la segunda relectura, solo para las que no traen ningún importe. Tesseract
 * es sensible al margen: en una captura de Lidl Plus de 422 px, «0,15 C» se leía «1» con
 * 0,35 y bien con 0,15, 0,25 o 0,5. Medido con OCR real en 7 imágenes (esa captura y las
 * sintéticas de fixtures/tickets/, a 400-1080 px, preparadas como en el navegador y como
 * foto): con 0,35 no traían importe 4 relecturas, y con 0,15 las 4 salían bien. Pero con
 * 0,15 para todas, 18 relecturas habrían dado otro importe (9 con 0,35): solo sirve para repetir.
 */
const TAIL_RETRY_PAD = 0.15
/** Lo que hace que una relectura sirva: algo con forma de importe («0,15»). */
const AMOUNT_SHAPE = /\d[,.]\d{2}/
const MAX_REREADS = 250
const IDLE_MS = 5 * 60 * 1000

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** Primera palabra del final numérico de la línea (cantidad, precio, importe, IVA), o null si no lo tiene. */
function numericTailStart(words: readonly Word[]): number | null {
  let start: number | null = null
  for (let i = words.length - 1; i >= 0 && words.length - i <= 6; i--) {
    const text = words[i].text.trim()
    const isLast = i === words.length - 1
    if (/\d/.test(text) || /^[xX×%*]$/.test(text) || (isLast && text.length <= 2)) start = i
    else break
  }
  if (start === null || !words.slice(start).some((w) => /\d/.test(w.text))) return null
  return start
}

const isWeightLine = (text: string) => /^\s*\d[\d\s.,]*kg\b/i.test(text)

function clampRect(rect: Rect, image: ImageInfo): Rect {
  const left = Math.max(0, Math.floor(rect.left))
  const top = Math.max(0, Math.floor(rect.top))
  const right = Math.min(image.width, Math.ceil(rect.left + rect.width))
  const bottom = Math.min(image.height, Math.ceil(rect.top + rect.height))
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

/** Lo que señala el final de la cabecera de Lidl cuando falta la línea «EUR»: el nombre, la dirección o el NIF. */
const HEADER_LINE = /LIDL\s+SUPERMERCADOS|S\.?A\.?U\.?\s*$|\bNIF\b|^\s*\d{5}\s?\p{L}|^\s*Copia\s*$/iu

/**
 * Líneas que merece la pena releer: las de productos, entre la cabecera y el
 * TOTAL (incluido). La cabecera acaba en «EUR»; si no se ha leído, en la
 * última línea de la cabecera de Lidl de las primeras.
 */
function rereadRange(lines: readonly Line[]): [number, number] {
  let start = lines.findIndex((line) => /^\s*EUR\s*$/i.test(line.text))
  if (start === -1) start = lines.slice(0, 15).findLastIndex((line) => HEADER_LINE.test(line.text))
  const end = lines.findIndex((line, i) => i > start && (/^\s*TOTAL\b/i.test(line.text) || endsProducts(line.text)))
  return [start + 1, end === -1 ? lines.length - 1 : end]
}

interface TextPass { lines: Line[]; result: OcrLine[] }

async function readText(worker: Worker, image: Buffer, info: ImageInfo, source: Omit<TicketSegment, 'image'>): Promise<TextPass> {
  const { data } = await worker.recognize(image, {}, { text: true, blocks: true })
  const lines = (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
  const result: OcrLine[] = lines.map((line) => ({ text: line.text.replace(/\n$/, ''), reread: null,
    confidence: line.confidence,
    words: line.words.map(w => ({ text: w.text, confidence: w.confidence, box: { ...w.bbox, y0: w.bbox.y0 + source.offsetY, y1: w.bbox.y1 + source.offsetY } })),
    source: { imageIndex: source.imageIndex, segmentIndex: source.segmentIndex, width: info.width, height: source.fullHeight,
      box: { ...line.bbox, y0: line.bbox.y0 + source.offsetY, y1: line.bbox.y1 + source.offsetY } } }))
  return { lines, result }
}

/** La segunda pasada de una franja: la banda de importes de cada línea de producto y las líneas de peso enteras. */
async function reread(worker: Worker, image: Buffer, info: ImageInfo, { lines, result }: TextPass, band: Band | null): Promise<void> {
  const [from, to] = rereadRange(lines)
  const tails: { index: number; rect: Rect; retry?: Rect }[] = []
  const weights: { index: number; rect: Rect; retry?: Rect }[] = []
  for (let i = from; i <= to && tails.length + weights.length < MAX_REREADS; i++) {
    const line = lines[i]
    const height = line.bbox.y1 - line.bbox.y0
    const pad = Math.max(2, Math.round(height * TAIL_PAD))
    if (isWeightLine(line.text)) {
      const rect = { left: line.bbox.x0 - pad, top: line.bbox.y0 - pad, width: line.bbox.x1 - line.bbox.x0 + 2 * pad, height: height + 2 * pad }
      weights.push({ index: i, rect: clampRect(rect, info) })
      continue
    }
    if (band) {
      // La banda entera a la altura de la línea, aunque la primera pasada no haya leído ahí ningún importe.
      tails.push({ index: i, rect: clampRect({ left: band.left, top: line.bbox.y0 - pad, width: band.right - band.left, height: height + 2 * pad }, info) })
      continue
    }
    const start = numericTailStart(line.words)
    if (start === null) continue
    const numeric = line.words.slice(start)
    // Sin banda (otro formato), como antes: un importe limpio y con mucha confianza no se relee.
    if (numeric.every(w => w.confidence >= 90) && /\d[,.]\d{2}\s+[ABC]\s*$/.test(line.text) && !/\d\s*[xX×*]\s*\d/.test(line.text)) continue
    const first = line.words[start]
    const tailRect = (pad: number) => clampRect({ left: first.bbox.x0 - pad, top: line.bbox.y0 - pad,
      width: line.bbox.x1 - first.bbox.x0 + 2 * pad, height: height + 2 * pad }, info)
    tails.push({ index: i, rect: tailRect(pad), retry: tailRect(Math.max(2, Math.round(height * TAIL_RETRY_PAD))) })
  }

  const readRect = async (rect: Rect) => (await worker.recognize(image, { rectangle: rect })).data.text.replace(/\s+/g, ' ').trim() || null
  for (const [targets, whitelist] of [
    [tails, TAIL_WHITELIST],
    [weights, WEIGHT_WHITELIST],
  ] as const) {
    if (targets.length === 0) continue
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: whitelist })
    for (const { index, rect, retry } of targets) {
      let text = await readRect(rect)
      // Una relectura sin importe no confirma nada: se repite una vez con el otro margen y, si
      // tampoco trae importe, se queda la primera (el analizador decide igual que antes).
      if (retry && !AMOUNT_SHAPE.test(text ?? '')) {
        const second = await readRect(retry)
        if (second && AMOUNT_SHAPE.test(second)) text = second
      }
      result[index].reread = text
    }
  }
  if (band && tails.length > 0) await rereadScaled(worker, image, lines, result, band, tails)
}

/**
 * Otra lectura de la banda de importes, independiente de las dos primeras:
 * la banda entera de la franja, reescalada (SECOND_SCALE) y leída de una vez
 * como un bloque. Cada renglón leído va a la línea que más solapa en altura,
 * en `rereads`. Solo con franjas PNG (las de pantalla); con una foto en JPEG
 * no hay tercera lectura.
 */
const SECOND_SCALE = 1.5
async function rereadScaled(worker: Worker, image: Buffer, lines: readonly Line[], result: OcrLine[], band: Band, tails: readonly { index: number; rect: Rect }[]): Promise<void> {
  const gray = decodePngGray(image)
  if (!gray) return
  const top = Math.min(...tails.map((t) => t.rect.top))
  const bottom = Math.max(...tails.map((t) => t.rect.top + t.rect.height))
  const left = Math.max(0, band.left)
  const scaled = scaleRegion(gray, left, top, Math.min(gray.width, band.right) - left, bottom - top, SECOND_SCALE)
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: TAIL_WHITELIST })
  const { data } = await worker.recognize(encodeGrayPng(scaled), {}, { text: true, blocks: true })
  const read = (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
    .map((line) => ({ text: line.text.replace(/\s+/g, ' ').trim(), y0: top + line.bbox.y0 / SECOND_SCALE, y1: top + line.bbox.y1 / SECOND_SCALE }))
    .filter((line) => line.text !== '')
  for (const { index } of tails) {
    const box = lines[index].bbox
    let best: { text: string; overlap: number } | null = null
    for (const line of read) {
      const overlap = Math.min(box.y1, line.y1) - Math.max(box.y0, line.y0)
      if (overlap > (box.y1 - box.y0) * 0.5 && (!best || overlap > best.overlap)) best = { text: line.text, overlap }
    }
    if (best) result[index].rereads = [best.text]
  }
}

/** La banda de importes de una imagen, con las líneas de todas sus franjas (comparten el eje x). */
function bandOf(passes: readonly TextPass[], width: number): Band | null {
  const lines = passes.flatMap((pass) => pass.lines)
  return amountBand(lines.map((line) => ({ text: line.text, x0: line.bbox.x0, x1: line.bbox.x1,
    words: line.words.map((w) => ({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1 })) })), width)
}

/**
 * Lee las franjas: primero el texto de todas y después, imagen a imagen, la
 * banda de importes (con las líneas de todas sus franjas) y la segunda pasada.
 */
async function readAll(worker: Worker, images: readonly Uint8Array[], segments: readonly Omit<TicketSegment, 'image'>[] | undefined): Promise<OcrLine[][]> {
  const prepared = images.map((bytes, i) => {
    // tesseract.js y imageInfo trabajan con Buffer; el puerto recibe Uint8Array (sin copiar nada).
    const image = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const info = imageInfo(image)
    if (!info) throw new Error('Imagen no válida')
    return { image, info, source: segments?.[i] ?? { imageIndex: i, segmentIndex: 0, offsetY: 0, fullHeight: info.height } }
  })
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN, tessedit_char_whitelist: '', preserve_interword_spaces: '1' })
  const passes: TextPass[] = []
  for (const { image, info, source } of prepared) passes.push(await readText(worker, image, info, source))
  const bands = new Map<number, Band | null>()
  for (const { info, source } of prepared) {
    if (!bands.has(source.imageIndex)) bands.set(source.imageIndex, bandOf(passes.filter((_, i) => prepared[i].source.imageIndex === source.imageIndex), info.width))
  }
  for (const [i, { image, info, source }] of prepared.entries()) await reread(worker, image, info, passes[i], bands.get(source.imageIndex) ?? null)
  return passes.map((pass) => pass.result)
}

/** Lector real (Tesseract). Las imágenes deben ser PNG o JPEG ya validados (ver validateTicketImage). */
export function createTesseractReader({ idleMs = IDLE_MS }: { idleMs?: number } = {}): TicketReader {
  let worker: Promise<Worker> | null = null
  let queue: Promise<unknown> = Promise.resolve()
  let idleTimer: NodeJS.Timeout | null = null

  const getWorker = () => {
    worker ??= createWorker('spa', OEM.LSTM_ONLY, { langPath: LANG_PATH, cacheMethod: 'none', gzip: true }).catch((error: unknown) => {
      worker = null
      throw error
    })
    return worker
  }

  const shutdown = async () => {
    const current = worker
    worker = null
    if (current) await (await current).terminate().catch(() => undefined)
  }

  const scheduleIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => void (queue = queue.then(shutdown, shutdown)), idleMs)
    idleTimer.unref()
  }

  return {
    read(images, segments) {
      const job = queue.then(async () => {
        if (idleTimer) clearTimeout(idleTimer)
        return readAll(await getWorker(), images, segments)
      })
      // Un fallo en un ticket no bloquea los siguientes.
      queue = job.catch(() => undefined).finally(scheduleIdle)
      return job
    },
    async close() {
      if (idleTimer) clearTimeout(idleTimer)
      await queue.catch(() => undefined)
      await shutdown()
    },
  }
}
