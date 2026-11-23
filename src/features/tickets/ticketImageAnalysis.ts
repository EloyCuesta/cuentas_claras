/**
 * Análisis de las imágenes de un ticket antes de leerlas, en funciones puras
 * sobre píxeles en gris (sin canvas ni DOM, para poder probarlas):
 *
 * - el tono del papel y si hay que invertir (texto claro sobre fondo oscuro);
 * - dónde está el papel: fuera la barra de estado, la cabecera de la app, el
 *   fondo y la barra de navegación cuando son de otro color;
 * - la altura de las mayúsculas, para escalar la imagen a la que mejor lee el
 *   OCR (medido con el banco: tools/banco-tickets/);
 * - si es una imagen de pantalla (fondo liso) o una foto;
 * - con varias capturas: las bandas fijas (las filas iguales a la misma altura
 *   en todas, como la barra de estado y la cabecera), cuánto se desplaza cada
 *   captura respecto a la anterior, y en qué orden van.
 *
 * Nunca se inventa una unión: si dos capturas no se solapan con claridad (la
 * diferencia es alta o dos desplazamientos son casi igual de buenos), se dice.
 */

export interface GrayImage {
  width: number
  height: number
  data: Uint8Array
}

/** Un rectángulo en píxeles: `right` y `bottom` no se incluyen. */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export function grayFromRgba(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < data.length; i++, p += 4) data[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000
  return { width, height, data }
}

export function invertGray(image: GrayImage): GrayImage {
  const data = new Uint8Array(image.data.length)
  for (let i = 0; i < data.length; i++) data[i] = 255 - image.data[i]
  return { ...image, data }
}

/** Un trozo de la imagen (sin copiar más que esas filas y columnas). */
export function cropGray(image: GrayImage, box: Box): GrayImage {
  const width = box.right - box.left
  const height = box.bottom - box.top
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) data.set(image.data.subarray((box.top + y) * image.width + box.left, (box.top + y) * image.width + box.right), y * width)
  return { width, height, data }
}

/**
 * El tono del papel: el gris más frecuente entre los claros, si ocupa al menos
 * una quinta parte de la imagen. Si no (texto claro sobre fondo oscuro), el más
 * frecuente entre los oscuros, y la imagen se invierte para leerla.
 */
export function paperTone(image: GrayImage): { tone: number; dark: boolean } {
  const histogram = new Uint32Array(256)
  const step = Math.max(1, Math.floor(image.data.length / 400_000))
  let count = 0
  for (let i = 0; i < image.data.length; i += step) { histogram[image.data[i]]++; count++ }
  const mode = (from: number, to: number) => {
    let best = from
    let bestCount = -1
    for (let v = from; v <= to; v++) {
      let around = 0
      for (let d = -2; d <= 2; d++) around += histogram[Math.min(255, Math.max(0, v + d))]
      if (around > bestCount) { best = v; bestCount = around }
    }
    return { value: best, share: bestCount / count }
  }
  const light = mode(128, 255)
  if (light.share >= 0.2) return { tone: light.value, dark: false }
  return { tone: 255 - mode(0, 127).value, dark: true }
}

/** Píxeles del color del papel (±10) e «tinta» (bastante más oscura que el papel). */
const PAPER_TOLERANCE = 10
const INK_DROP = 80

/**
 * Dónde está el papel: las columnas y las filas que son del color del papel en
 * su mayoría (el texto ocupa menos de la mitad de cualquier columna o fila). Lo
 * que no lo es (el fondo oscuro o gris alrededor, las barras de la app en modo
 * oscuro) se queda fuera. Devuelve el bloque de filas de papel más alto.
 */
export function findPaper(image: GrayImage, tone: number): Box | null {
  const { width, height, data } = image
  const isPaper = (v: number) => Math.abs(v - tone) <= PAPER_TOLERANCE || v < tone - INK_DROP
  const columnPaper = new Uint32Array(width)
  const rowStep = Math.max(1, Math.floor(height / 1500))
  let rows = 0
  for (let y = 0; y < height; y += rowStep, rows++) {
    const row = y * width
    for (let x = 0; x < width; x++) if (Math.abs(data[row + x] - tone) <= PAPER_TOLERANCE) columnPaper[x]++
  }
  let left = 0
  while (left < width && columnPaper[left] < rows * 0.5) left++
  let right = width
  while (right > left && columnPaper[right - 1] < rows * 0.5) right--
  if (right - left < width * 0.2) return null
  // Filas del papel: las que tienen en blanco sus dos márgenes (aunque en medio haya un logotipo, una raya o
  // un recuadro) o las que son casi todas papel o tinta (un ticket sin márgenes).
  const paperRow = new Uint8Array(height)
  const span = right - left
  const marginFrom = Math.floor(span * 0.005)
  const marginTo = Math.max(marginFrom + 2, Math.floor(span * 0.03))
  const plainShare = (row: number, from: number, to: number) => {
    let plain = 0
    for (let x = from; x < to; x++) if (Math.abs(data[row + x] - tone) <= PAPER_TOLERANCE) plain++
    return plain / Math.max(1, to - from)
  }
  for (let y = 0; y < height; y++) {
    const row = y * width
    if (plainShare(row, left + marginFrom, left + marginTo) >= 0.7 && plainShare(row, right - marginTo, right - marginFrom) >= 0.7) {
      paperRow[y] = 1
      continue
    }
    let paper = 0
    let plain = 0
    for (let x = left; x < right; x += 2) {
      const v = data[row + x]
      if (isPaper(v)) paper++
      if (Math.abs(v - tone) <= PAPER_TOLERANCE) plain++
    }
    paperRow[y] = paper >= (span / 2) * 0.9 && plain >= (span / 2) * 0.5 ? 1 : 0
  }
  let best: [number, number] | null = null
  for (let y = 0; y < height;) {
    if (!paperRow[y]) { y++; continue }
    let end = y
    // Se toleran filas sueltas que no lo parecen (una raya o un recuadro de lado a lado).
    for (let gap = 0; end < height && gap <= 6; end++) gap = paperRow[end] ? 0 : gap + 1
    while (end > y && !paperRow[end - 1]) end--
    if (!best || end - y > best[1] - best[0]) best = [y, end]
    y = end + 1
  }
  if (!best || best[1] - best[0] < height * 0.05) return null
  return { left, top: best[0], right, bottom: best[1] }
}

/** Filas con tinta dentro de un rectángulo (cuántos píxeles oscuros tiene cada una). */
function rowInk(image: GrayImage, box: Box, tone: number): Uint32Array {
  const ink = new Uint32Array(box.bottom - box.top)
  for (let y = box.top; y < box.bottom; y++) {
    let count = 0
    const row = y * image.width
    for (let x = box.left; x < box.right; x++) if (image.data[row + x] < tone - INK_DROP) count++
    ink[y - box.top] = count
  }
  return ink
}

/** Ajusta un rectángulo de papel a lo escrito, con un margen (los márgenes vacíos no se leen). */
export function contentBox(image: GrayImage, paper: Box, tone: number, margin: number): Box {
  const rows = rowInk(image, paper, tone)
  let top = 0
  while (top < rows.length && rows[top] === 0) top++
  let bottom = rows.length
  while (bottom > top && rows[bottom - 1] === 0) bottom--
  if (top >= bottom) return paper
  let left = paper.right
  let right = paper.left
  for (let y = paper.top + top; y < paper.top + bottom; y += 2) {
    const row = y * image.width
    for (let x = paper.left; x < left; x++) if (image.data[row + x] < tone - INK_DROP) { left = x; break }
    for (let x = paper.right - 1; x >= right; x--) if (image.data[row + x] < tone - INK_DROP) { right = x + 1; break }
  }
  return {
    left: Math.max(paper.left, left - margin), right: Math.min(paper.right, right + margin),
    top: Math.max(paper.top, paper.top + top - margin), bottom: Math.min(paper.bottom, paper.top + bottom + margin),
  }
}

/**
 * Altura de las mayúsculas, en píxeles: la mediana del «cuerpo» de cada renglón
 * (las filas con al menos una cuarta parte de la tinta de su fila más cargada).
 * Así no cuentan las tildes, las comas ni las colas, y un título grande suelto
 * no mueve la mediana. null si no hay renglones que medir.
 */
export function measureTextHeight(image: GrayImage, box: Box, tone: number): number | null {
  const ink = rowInk(image, box, tone)
  const noise = Math.max(1, Math.round((box.right - box.left) * 0.002))
  const heights: number[] = []
  for (let y = 0; y < ink.length;) {
    if (ink[y] < noise) { y++; continue }
    let end = y
    let peak = 0
    while (end < ink.length && ink[end] >= noise) { peak = Math.max(peak, ink[end]); end++ }
    let first = -1
    let last = -1
    for (let r = y; r < end; r++) if (ink[r] >= peak / 4) { if (first < 0) first = r; last = r }
    if (last - first + 1 >= 4) heights.push(last - first + 1)
    y = end
  }
  if (heights.length < 3) return null
  heights.sort((a, b) => a - b)
  return heights[Math.floor(heights.length / 2)]
}

/**
 * Una imagen de pantalla tiene el fondo liso: la mayoría del papel es
 * exactamente de su tono. Una foto de papel tiene sombras y grano.
 */
export function isScreenImage(image: GrayImage, box: Box, tone: number): boolean {
  let flat = 0
  let paper = 0
  for (let y = box.top; y < box.bottom; y += 3) {
    for (let x = box.left; x < box.right; x += 3) {
      const v = image.data[y * image.width + x]
      if (Math.abs(v - tone) <= PAPER_TOLERANCE) { paper++; if (Math.abs(v - tone) <= 2) flat++ }
    }
  }
  return paper > 0 && flat / paper >= 0.85
}

/**
 * Las bandas fijas de varias capturas del mismo tamaño: cuántas filas de arriba
 * y de abajo son iguales en todas (la barra de estado, la cabecera, la barra de
 * navegación). Se tolera alguna diferencia pequeña en la fila (el reloj, la
 * batería). Con una sola captura no hay nada que comparar.
 */
export function fixedBands(images: readonly GrayImage[]): { top: number; bottom: number } {
  if (images.length < 2) return { top: 0, bottom: 0 }
  const [first] = images
  if (images.some((image) => image.width !== first.width)) return { top: 0, bottom: 0 }
  const height = Math.min(...images.map((image) => image.height))
  const same = (y: (image: GrayImage) => number) => images.slice(1).every((image) => {
    let differ = 0
    const a = y(first) * first.width
    const b = y(image) * image.width
    for (let x = 0; x < first.width; x += 2) if (Math.abs(first.data[a + x] - image.data[b + x]) > 30) differ++
    return differ <= (first.width / 2) * 0.12
  })
  let top = 0
  while (top < height && same(() => top)) top++
  let bottom = 0
  while (bottom < height - top && same((image) => image.height - 1 - bottom)) bottom++
  // Capturas iguales (la misma dos veces): no hay bandas que quitar.
  if (top + bottom >= height * 0.9) return { top: 0, bottom: 0 }
  return { top, bottom }
}

/** Huella de cada fila: la media de bloques de columnas, para comparar rápido. */
interface Signature { rows: number; cols: number; values: Float32Array; ink: Uint8Array }

function signature(image: GrayImage, block: number, tone: number): Signature {
  const cols = Math.max(1, Math.floor(image.width / block))
  const rows = image.height
  const values = new Float32Array(rows * cols)
  const ink = new Uint8Array(rows)
  for (let y = 0; y < rows; y++) {
    const row = y * image.width
    for (let c = 0; c < cols; c++) {
      let sum = 0
      for (let x = c * block; x < (c + 1) * block; x++) {
        const v = image.data[row + x]
        sum += v
        if (v < tone - INK_DROP) ink[y] = 1
      }
      values[y * cols + c] = sum / block
    }
  }
  return { rows, cols, values, ink }
}

export interface Overlap {
  /** Fila de la primera captura donde empieza la segunda. */
  offset: number
  /** Diferencia media (0-255) en las filas con texto del solape: cuanto más baja, mejor. */
  score: number
  /** Otro desplazamiento casi igual de bueno: no se puede decidir. */
  ambiguous: boolean
}

/** Diferencia media por encima de la cual dos trozos no son el mismo. */
export const OVERLAP_MAX_SCORE = 12

/** Diferencia media entre dos huellas con `b` empezando en la fila `offset` de `a`, mirando cada `step` filas con texto. */
function scoreOf(sa: Signature, sb: Signature, offset: number, step: number, minCounted: number): number {
  const length = Math.min(sa.rows - offset, sb.rows)
  let total = 0
  let counted = 0
  for (let i = 0; i < length; i += step) {
    if (!sa.ink[offset + i] && !sb.ink[i]) continue
    const ra = (offset + i) * sa.cols
    const rb = i * sb.cols
    let diff = 0
    for (let c = 0; c < sa.cols; c++) diff += Math.abs(sa.values[ra + c] - sb.values[rb + c])
    total += diff / sa.cols
    counted++
  }
  return counted >= minCounted ? total / counted : Infinity
}

/** La huella reducida: la media de cada `factor` filas (y con tinta si alguna la tiene). */
function shrink(signature: Signature, factor: number): Signature {
  const rows = Math.floor(signature.rows / factor)
  const { cols } = signature
  const values = new Float32Array(rows * cols)
  const ink = new Uint8Array(rows)
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < factor; k++) {
      const row = r * factor + k
      if (signature.ink[row]) ink[r] = 1
      for (let c = 0; c < cols; c++) values[r * cols + c] += signature.values[row * cols + c] / factor
    }
  }
  return { rows, cols, values, ink }
}

/** La búsqueda gruesa compara cada 4 filas (con las huellas reducidas) y se afinan, fila a fila, sus 8 mejores candidatos. */
const COARSE = 4
const CANDIDATES = 8

/**
 * Cuánto se desplaza la captura `b` respecto a `a` (las dos sin bandas fijas y
 * del mismo ancho): la fila de `a` donde empieza `b`, con la menor diferencia
 * en las filas con texto. Solo cuentan solapes de al menos `minOverlap` filas y
 * con texto suficiente. null si no hay ninguno posible.
 *
 * De grueso a fino: las huellas reducidas (la media de cada 4 filas) dan los
 * mejores candidatos, y solo alrededor de ellos se compara fila a fila. Mirar
 * todos los desplazamientos fila a fila costaba unas 8 veces más; con 6
 * capturas de 2400 px, varios segundos en un móvil.
 */
export function findOverlap(a: GrayImage, b: GrayImage, tone: number, minOverlap = 60): Overlap | null {
  if (a.width !== b.width) return null
  const block = Math.max(4, Math.round(a.width / 90))
  const sa = signature(a, block, tone)
  const sb = signature(b, block, tone)
  const last = sa.rows - minOverlap
  if (last < 0) return null
  const ca = shrink(sa, COARSE)
  const cb = shrink(sb, COARSE)
  const coarse: [number, number][] = []
  for (let offset = 0; offset * COARSE <= last; offset++) coarse.push([offset * COARSE, scoreOf(ca, cb, offset, 1, 2)])
  coarse.sort((x, y) => x[1] - y[1] || x[0] - y[0])
  const picked: number[] = []
  for (const [offset, score] of coarse) {
    if (!Number.isFinite(score) || picked.length === CANDIDATES) break
    if (!picked.some((p) => Math.abs(p - offset) <= 2 * COARSE)) picked.push(offset)
  }
  const refined = new Map<number, number>()
  for (const center of picked) {
    for (let offset = Math.max(0, center - COARSE - 2); offset <= Math.min(last, center + COARSE + 2); offset++) {
      if (!refined.has(offset)) refined.set(offset, scoreOf(sa, sb, offset, 2, 8))
    }
  }
  const scores = [...refined].sort((x, y) => x[1] - y[1] || x[0] - y[0])
  const [best] = scores
  if (!best || !Number.isFinite(best[1])) return null
  // El siguiente mejor que no sea el mismo desplazamiento (± media línea) decide si hay duda.
  const second = scores.find(([offset]) => Math.abs(offset - best[0]) > 6)
  const ambiguous = second !== undefined && second[1] - best[1] < Math.max(3, best[1] * 0.5)
  return { offset: best[0], score: best[1], ambiguous }
}

/** Si un solape vale para unir dos capturas. */
export const overlapUsable = (overlap: Overlap | null): boolean =>
  overlap !== null && overlap.score <= OVERLAP_MAX_SCORE && !overlap.ambiguous

/**
 * El orden de las capturas por sus solapes: si en el orden elegido cada una
 * continúa a la anterior, se queda así; si no, se busca otro orden en el que
 * sí (hasta 6 capturas, probando todos). `pairs(i, j)` dice si j continúa a i.
 */
export function orderCaptures(count: number, pairs: (i: number, j: number) => boolean): number[] {
  const given = Array.from({ length: count }, (_, i) => i)
  const chained = (order: number[]) => order.every((image, k) => k === 0 || pairs(order[k - 1], image))
  if (count < 3 && chained(given)) return given
  if (chained(given)) return given
  const permutations = (items: number[]): number[][] => items.length <= 1 ? [items]
    : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]))
  if (count > 6) return given
  return permutations(given).find(chained) ?? given
}

export const TARGET_TEXT_HEIGHT = 21

/** La escala que deja las mayúsculas a la altura que mejor lee el OCR, dentro de unos límites razonables. */
export function scaleForTextHeight(textHeight: number, target = TARGET_TEXT_HEIGHT): number {
  return Math.min(4, Math.max(0.25, target / textHeight))
}
