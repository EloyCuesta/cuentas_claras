import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createWorker, OEM, PSM, type Line, type Word, type Worker } from 'tesseract.js'
import type { OcrLine, TicketSegment } from '#shared/tickets/types.ts'
import { endsProducts } from '#shared/tickets/ticketParse.ts'
import { imageInfo, type ImageInfo } from './common/imageInfo.ts'

/**
 * Lector de tickets: OCR con Tesseract (tesseract.js), en este mismo equipo.
 * Las imágenes no salen de casa y no se descarga nada al usarlo: el modelo de
 * español viene en node_modules (@tesseract.js-data/spa).
 *
 * Dos pasadas por imagen:
 * 1. Texto completo, línea a línea (nombres, fechas, total…), en modo «una
 *    columna» (PSM 4): un ticket es una sola columna de texto de distintos
 *    tamaños. Medido con OCR real sobre 132 líneas de tickets de prueba (capturas
 *    a 400-1080 px y fotos): 111 líneas limpias frente a 104 con PSM 6 (bloque),
 *    sin ningún importe erróneo aceptado en silencio en ninguno de los dos.
 * 2. Solo la parte final de cada línea de producto (cantidad × precio,
 *    importe y letra de IVA), leída otra vez con una lista de caracteres
 *    permitidos (cifras, coma, x, A/B/C). En las capturas pequeñas o
 *    borrosas es donde más se equivoca la primera pasada.
 *    Leer solo la palabra del importe (PSM 8) o quitar la lista de caracteres
 *    dio peores resultados en esa misma medición.
 * Las dos lecturas se entregan al analizador (shared/tickets/ticketParse.ts), que
 * las compara entre sí y con la multiplicación de la línea. El total del
 * ticket nunca decide un importe.
 *
 * Un solo «worker» para todas las peticiones, de una en una. Se cierra tras
 * unos minutos sin uso para liberar memoria y se vuelve a abrir al necesitarlo.
 */

export interface TicketReader {
  /** Una lista de líneas por imagen, en orden. */
  read(images: readonly Buffer[], segments?: readonly Omit<TicketSegment, 'image'>[]): Promise<OcrLine[][]>
  close(): Promise<void>
}

const require = createRequire(import.meta.url)
const LANG_PATH = join(dirname(require.resolve('@tesseract.js-data/spa/package.json')), '4.0.0_best_int')

/** Caracteres de la parte final de una línea de producto: «3,95x 2 7,90 B». */
const TAIL_WHITELIST = '0123456789,.-xX ABC'
/** Caracteres de una línea de peso: «0,544 kg x 6,75 EUR/kg». */
const WEIGHT_WHITELIST = '0123456789,.kgxEUR/ '
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

/** Líneas que merece la pena releer: las de productos, entre la cabecera «EUR» y el TOTAL (incluido). */
function rereadRange(lines: readonly Line[]): [number, number] {
  const start = lines.findIndex((line) => /^\s*EUR\s*$/i.test(line.text))
  const end = lines.findIndex((line, i) => i > start && (/^\s*TOTAL\b/i.test(line.text) || endsProducts(line.text)))
  return [start === -1 ? 0 : start + 1, end === -1 ? lines.length - 1 : end]
}

async function readImage(worker: Worker, image: Buffer, info: ImageInfo, source: Omit<TicketSegment, 'image'>): Promise<OcrLine[]> {
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
    tessedit_char_whitelist: '',
    preserve_interword_spaces: '1',
  })
  const { data } = await worker.recognize(image, {}, { text: true, blocks: true })
  const lines = (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
  const result: OcrLine[] = lines.map((line) => ({ text: line.text.replace(/\n$/, ''), reread: null,
    confidence: line.confidence,
    words: line.words.map(w => ({ text: w.text, confidence: w.confidence, box: { ...w.bbox, y0: w.bbox.y0 + source.offsetY, y1: w.bbox.y1 + source.offsetY } })),
    source: { imageIndex: source.imageIndex, segmentIndex: source.segmentIndex, width: info.width, height: source.fullHeight,
      box: { ...line.bbox, y0: line.bbox.y0 + source.offsetY, y1: line.bbox.y1 + source.offsetY } } }))

  const [from, to] = rereadRange(lines)
  const tails: { index: number; rect: Rect }[] = []
  const weights: { index: number; rect: Rect }[] = []
  for (let i = from; i <= to && tails.length + weights.length < MAX_REREADS; i++) {
    const line = lines[i]
    const height = line.bbox.y1 - line.bbox.y0
    const pad = Math.max(2, Math.round(height * 0.35))
    if (isWeightLine(line.text)) {
      const rect = { left: line.bbox.x0 - pad, top: line.bbox.y0 - pad, width: line.bbox.x1 - line.bbox.x0 + 2 * pad, height: height + 2 * pad }
      weights.push({ index: i, rect: clampRect(rect, info) })
      continue
    }
    const start = numericTailStart(line.words)
    if (start === null) continue
    const numeric = line.words.slice(start)
    // Multiunit arithmetic benefits from an independent reading. Clean,
    // high-confidence single amounts do not need another Tesseract call.
    if (numeric.every(w => w.confidence >= 90) && /\d[,.]\d{2}\s+[ABC]\s*$/.test(line.text) && !/\d\s*[xX×*]\s*\d/.test(line.text)) continue
    const first = line.words[start]
    const rect = { left: first.bbox.x0 - pad, top: line.bbox.y0 - pad, width: line.bbox.x1 - first.bbox.x0 + 2 * pad, height: height + 2 * pad }
    tails.push({ index: i, rect: clampRect(rect, info) })
  }

  for (const [targets, whitelist] of [
    [tails, TAIL_WHITELIST],
    [weights, WEIGHT_WHITELIST],
  ] as const) {
    if (targets.length === 0) continue
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: whitelist })
    for (const { index, rect } of targets) {
      const { data: reread } = await worker.recognize(image, { rectangle: rect })
      result[index].reread = reread.text.replace(/\s+/g, ' ').trim() || null
    }
  }
  return result
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
        const tesseract = await getWorker()
        const pages: OcrLine[][] = []
        for (const [i, image] of images.entries()) {
          const info = imageInfo(image)
          if (!info) throw new Error('Imagen no válida')
          pages.push(await readImage(tesseract, image, info, segments?.[i] ?? { imageIndex: i, segmentIndex: 0, offsetY: 0, fullHeight: info.height }))
        }
        return pages
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
