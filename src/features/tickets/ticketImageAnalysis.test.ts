import { describe, expect, it } from 'vitest'
import {
  contentBox, cropGray, findOverlap, findPaper, fixedBands, invertGray, isScreenImage, measureTextHeight, orderCaptures,
  overlapUsable, paperTone, scaleForTextHeight, type GrayImage,
} from './ticketImageAnalysis.ts'

/** Una imagen en gris de un solo tono. */
const blank = (width: number, height: number, value = 255): GrayImage => ({ width, height, data: new Uint8Array(width * height).fill(value) })
const fill = (image: GrayImage, left: number, top: number, right: number, bottom: number, value: number) => {
  for (let y = top; y < bottom; y++) image.data.fill(value, y * image.width + left, y * image.width + right)
}

/** Números pseudoaleatorios repetibles. */
function random(seed: number) {
  let state = seed
  return () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648 }
}

/**
 * Un renglón de «texto»: letras de `cap` px de alto (rectángulos con un hueco
 * en medio, de anchos al azar) y una coma que baja por debajo de la línea.
 */
function text(image: GrayImage, left: number, top: number, chars: number, cap: number, next: () => number, ink = 20) {
  const advance = Math.round(cap * 0.85)
  for (let c = 0; c < chars; c++) {
    if (next() < 0.2) continue
    const x = left + c * advance
    const width = Math.max(2, Math.round(advance * (0.4 + next() * 0.4)))
    fill(image, x, top, x + width, top + 3, ink)
    fill(image, x, top + cap - 3, x + width, top + cap, ink)
    fill(image, x, top, x + 2, top + cap, ink)
  }
  // La coma de un importe: unas filas por debajo de la línea, con muy poca tinta.
  fill(image, left + chars * advance - 20, top + cap, left + chars * advance - 18, top + cap + Math.round(cap / 4), ink)
}

/** Un ticket largo: renglones distintos, con la interlínea del ticket (algo más del doble de la altura de las mayúsculas). */
function ticket(width: number, height: number, cap: number, seed = 7): GrayImage {
  const image = blank(width, height)
  const next = random(seed)
  for (let y = 40; y + cap + 10 < height; y += Math.round(cap * 2.2)) text(image, 30, y, Math.floor((width - 60) / Math.round(cap * 0.85)), cap, next)
  return image
}

describe('análisis de las imágenes de un ticket', () => {
  it('el papel claro con texto oscuro no se invierte; el papel oscuro con texto claro, sí', () => {
    const paper = ticket(300, 400, 14)
    expect(paperTone(paper)).toEqual({ tone: 255, dark: false })
    expect(paperTone(invertGray(paper))).toEqual({ tone: 255, dark: true })
  })

  it('encuentra el papel blanco dentro de la app en modo oscuro (barras y fondo fuera)', () => {
    const screen = blank(400, 800, 20)
    fill(screen, 0, 0, 400, 40, 35) // barra de estado
    fill(screen, 0, 40, 400, 110, 35) // cabecera
    fill(screen, 0, 740, 400, 800, 35) // barra de navegación
    fill(screen, 16, 130, 384, 700, 255) // el papel
    const next = random(3)
    for (let y = 150; y < 680; y += 22) text(screen, 30, y, 24, 13, next)
    const box = findPaper(screen, 255)!
    expect(box).toEqual({ left: 16, top: 130, right: 384, bottom: 700 })
  })

  it('un logotipo gris, una raya de lado a lado o un recuadro no parten el papel', () => {
    const screen = blank(400, 800, 20)
    fill(screen, 16, 100, 384, 760, 255)
    fill(screen, 150, 120, 250, 220, 200) // el recuadro gris del logotipo
    fill(screen, 30, 400, 370, 420, 190) // una raya gruesa y borrosa (JPEG)
    fill(screen, 40, 600, 330, 604, 0) // el borde de un recuadro
    const next = random(9)
    for (let y = 240; y < 740; y += 26) if (y < 395 || y > 425) text(screen, 30, y, 22, 13, next)
    expect(findPaper(screen, 255)).toEqual({ left: 16, top: 100, right: 384, bottom: 760 })
  })

  it('ajusta el papel a lo escrito, con un margen', () => {
    const image = blank(300, 300)
    fill(image, 50, 100, 200, 120, 0)
    expect(contentBox(image, { left: 0, top: 0, right: 300, bottom: 300 }, 255, 10)).toEqual({ left: 40, top: 90, right: 210, bottom: 130 })
  })

  it('mide la altura de las mayúsculas sin contar comas, y una imagen sin texto no se mide', () => {
    for (const cap of [10, 22, 27]) {
      const image = ticket(900, 900, cap)
      expect(measureTextHeight(image, { left: 0, top: 0, right: 900, bottom: 900 }, 255)).toBe(cap)
    }
    expect(measureTextHeight(blank(100, 100), { left: 0, top: 0, right: 100, bottom: 100 }, 255)).toBeNull()
  })

  it('una captura de pantalla tiene el fondo liso; una foto, no', () => {
    const screen = ticket(200, 200, 12)
    const photo = blank(200, 200)
    const next = random(5)
    for (let i = 0; i < photo.data.length; i++) photo.data[i] = 235 + Math.round(next() * 18)
    const all = { left: 0, top: 0, right: 200, bottom: 200 }
    expect(isScreenImage(screen, all, 255)).toBe(true)
    expect(isScreenImage(photo, all, paperTone(photo).tone)).toBe(false)
  })

  it('quita las bandas fijas de varias capturas, aunque cambie el reloj', () => {
    const long = ticket(400, 3000, 14)
    const captures = [0, 600, 1200].map((y, i) => {
      const capture = blank(400, 1000)
      capture.data.set(cropGray(long, { left: 0, top: y, right: 400, bottom: y + 840 }).data, 100 * 400)
      fill(capture, 0, 0, 400, 100, 40)
      fill(capture, 10 + i * 3, 30, 40 + i * 3, 60, 255) // el reloj
      fill(capture, 0, 940, 400, 1000, 40)
      return capture
    })
    // Las filas en blanco junto a las barras también son iguales en todas: no importa quitarlas.
    const bands = fixedBands(captures)
    expect(bands.bottom).toBeGreaterThanOrEqual(60)
    expect(bands.bottom).toBeLessThan(100)
    expect(bands.top).toBeGreaterThanOrEqual(100)
    expect(bands.top).toBeLessThan(140)
    expect(fixedBands([captures[0]])).toEqual({ top: 0, bottom: 0 })
    expect(fixedBands([captures[0], captures[0]])).toEqual({ top: 0, bottom: 0 })
  })

  it('encuentra cuánto se solapan dos capturas seguidas, y dice cuándo no se solapan', () => {
    const long = ticket(400, 3000, 14)
    const part = (top: number) => cropGray(long, { left: 0, top, right: 400, bottom: top + 900 })
    const overlap = findOverlap(part(0), part(700), 255)!
    expect(overlap).toMatchObject({ offset: 700, ambiguous: false })
    expect(overlap.score).toBeLessThan(1)
    expect(overlapUsable(overlap)).toBe(true)
    expect(overlapUsable(findOverlap(part(0), part(1500), 255))).toBe(false)
  })

  it('la búsqueda de grueso a fino da el desplazamiento exacto, también entre las filas que mira la búsqueda gruesa', () => {
    const long = ticket(400, 3000, 14)
    const part = (top: number) => cropGray(long, { left: 0, top, right: 400, bottom: top + 900 })
    for (const offset of [61, 333, 402, 597, 702, 803]) {
      const overlap = findOverlap(part(100), part(100 + offset), 255)!
      expect(overlap, `desplazamiento ${offset}`).toMatchObject({ offset, ambiguous: false })
      expect(overlap.score).toBeLessThan(1)
    }
  })

  it('si el ticket se repite (renglones iguales), el solape es ambiguo y no se usa', () => {
    const image = blank(400, 1800)
    const line = blank(400, 24)
    text(line, 30, 4, 24, 14, random(1))
    for (let y = 0; y + 24 <= 1800; y += 24) image.data.set(line.data, y * 400)
    const overlap = findOverlap(cropGray(image, { left: 0, top: 0, right: 400, bottom: 900 }), cropGray(image, { left: 0, top: 600, right: 400, bottom: 1500 }), 255)
    expect(overlap?.ambiguous).toBe(true)
    expect(overlapUsable(overlap)).toBe(false)
  })

  it('ordena las capturas por sus solapes si vienen desordenadas, y si no hay orden posible las deja como estaban', () => {
    const next = new Map([[2, 0], [0, 1]]) // la 3.ª va antes que la 1.ª y la 1.ª antes que la 2.ª
    expect(orderCaptures(3, (i, j) => next.get(i) === j)).toEqual([2, 0, 1])
    expect(orderCaptures(3, (i, j) => j === i + 1)).toEqual([0, 1, 2])
    expect(orderCaptures(3, () => false)).toEqual([0, 1, 2])
  })

  it('escala para dejar las mayúsculas a la altura que mejor lee el OCR', () => {
    expect(scaleForTextHeight(27.5, 22)).toBeCloseTo(0.8)
    expect(scaleForTextHeight(11, 22)).toBe(2)
    expect(scaleForTextHeight(2, 22)).toBe(4)
  })
})
