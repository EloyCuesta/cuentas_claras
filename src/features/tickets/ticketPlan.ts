import {
  cropGray, findOverlap, findPaper, fixedBands, orderCaptures, OVERLAP_MAX_SCORE, overlapUsable, type Box, type GrayImage, type Overlap,
} from './ticketImageAnalysis.ts'

/**
 * Qué imágenes se envían a leer: une las capturas que se solapan y avisa de lo
 * que no se puede unir. Es una función pura sobre las copias en gris (sin
 * canvas ni DOM), así que se prueba sola y se puede calcular en un Web Worker
 * (`ticketPlan.worker.ts`).
 *
 * - Solo se unen capturas del mismo tamaño, con el texto del mismo color (todas
 *   claras o todas oscuras) y con los bordes del papel en el mismo sitio. Si no,
 *   van por separado y se avisa antes de leer.
 * - Se quitan las bandas fijas (barra de estado, cabecera, navegación), se busca
 *   cuánto se desplaza cada captura respecto a la anterior y se pega solo lo
 *   nuevo, cortando en la mitad del solape.
 * - Una captura que cabe entera dentro de la anterior no aporta filas: se trata
 *   como repetida (no se usa) y se avisa. Nunca se pierde una fila.
 * - Si dos capturas no se solapan con claridad no se inventa nada: se avisa y
 *   van por separado.
 */

/** Lo que hace falta de cada imagen elegida: su copia de análisis en gris (ya invertida si era oscura). */
export interface PlanSource {
  gray: GrayImage
  /** El tono del papel. */
  tone: number
  /** El texto era claro sobre fondo oscuro. */
  dark: boolean
  /** Recortar al papel. */
  autoCrop: boolean
}

/** Un trozo de una imagen elegida dentro de una imagen unida: sus filas (en la copia de análisis) y dónde van. */
export interface Piece { source: number; top: number; bottom: number; y: number }

/** Una imagen que se envía a leer: una o varias capturas unidas, en coordenadas de la copia de análisis. */
export interface Group {
  sources: number[]
  pieces: Piece[]
  left: number
  right: number
  height: number
}

export interface Plan { groups: Group[]; warnings: string[] }

const APART = 'se leen por separado, revisa si hay productos repetidos o que falten.'

export function planCaptures(sources: readonly PlanSource[]): Plan {
  if (sources.length === 0) return { groups: [], warnings: [] }
  const warnings: string[] = []
  const sameSize = sources.length > 1 && sources.every((s) => s.gray.width === sources[0].gray.width && s.gray.height === sources[0].gray.height)
  const sameInk = sources.every((s) => s.dark === sources[0].dark)
  const bands = sameSize ? fixedBands(sources.map((s) => s.gray)) : { top: 0, bottom: 0 }
  const papers = sources.map((source) => {
    const region: Box = { left: 0, top: bands.top, right: source.gray.width, bottom: source.gray.height - bands.bottom }
    if (!source.autoCrop) return region
    const paper = findPaper(cropGray(source.gray, region), source.tone)
    return paper ? { left: paper.left, right: paper.right, top: paper.top + region.top, bottom: paper.bottom + region.top } : region
  })
  // Para comparar capturas, el mismo ancho en todas: el del papel de la primera, si todas lo tienen parecido.
  const sameBorders = papers.every((p) => Math.abs(p.left - papers[0].left) <= 4 && Math.abs(p.right - papers[0].right) <= 4)
  const stitchable = sameSize && sameInk && sameBorders
  if (sources.length > 1 && !stitchable) {
    warnings.push(!sameSize ? `Las imágenes no tienen el mismo tamaño y no se pueden unir: ${APART}`
      : !sameInk ? `Unas capturas son claras y otras oscuras y no se pueden unir: ${APART}`
        : `Los bordes del ticket no coinciden en todas las capturas y no se pueden unir: ${APART}`)
  }
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
  /** La última captura usada, y la última repetida que se saltó dentro de ella (con dónde empieza en la usada). */
  let previous = order[0]
  let repeated: { source: number; offset: number } | null = null
  for (let k = 1; k < order.length; k++) {
    const next = order[k]
    let found = stitchable ? overlap(previous, next) : null
    // Si la anterior era repetida, la siguiente pudo encajar con ella: su solape vale también en la usada.
    if (stitchable && !overlapUsable(found) && repeated && overlapUsable(overlap(repeated.source, next))) {
      const viaRepeated: Overlap = overlap(repeated.source, next)!
      found = { ...viaRepeated, offset: repeated.offset + viaRepeated.offset }
    }
    if (found && overlapUsable(found)) {
      // Cabe entera dentro de la anterior: no aporta ninguna fila. Se trata como repetida.
      if (found.offset + contents[next].height <= contents[previous].height) {
        warnings.push(`La captura ${next + 1} ya está dentro de la ${previous + 1}: no aporta nada nuevo y no se usa.`)
        repeated = { source: next, offset: found.offset }
        continue
      }
      // Lo nuevo de la siguiente empieza en la mitad del solape: ahí las dos tienen renglones enteros. Nunca antes de
      // donde empieza el trozo de la anterior (si ya se le cortó la parte de arriba), para no dejarlo vacío.
      const last = current.pieces.at(-1)!
      const lastCut = last.top - papers[previous].top
      const lastStart = last.y - lastCut
      const cut = Math.max(Math.floor((contents[previous].height - found.offset) / 2), lastCut - found.offset)
      last.bottom = papers[previous].top + found.offset + cut
      const y = lastStart + found.offset
      current.pieces.push({ source: next, top: papers[next].top + cut, bottom: papers[next].bottom, y: y + cut })
      current.sources.push(next)
      current.height = y + contents[next].height
      previous = next
      repeated = null
      continue
    }
    if (stitchable) {
      warnings.push(found && found.score <= OVERLAP_MAX_SCORE && found.ambiguous
        ? `No está claro dónde se solapan las capturas ${previous + 1} y ${next + 1}: ${APART}`
        : `Las capturas ${previous + 1} y ${next + 1} no se solapan: puede faltar una parte del ticket.`)
    }
    groups.push(current)
    current = single(next)
    previous = next
    repeated = null
  }
  groups.push(current)
  return { groups, warnings }
}

/** La copia de análisis de una imagen unida (para medir lo escrito y las letras). */
export function groupGray(group: Group, sources: readonly Pick<PlanSource, 'gray' | 'tone'>[]): GrayImage {
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
