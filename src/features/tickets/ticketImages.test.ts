import { describe, expect, it } from 'vitest'
import { enhanceForOcr, imageLayout, imageQuality, luminanceRange, needsEnhancement, rotatedSourceRect, type TicketImageOptions } from './ticketImages.ts'

/** Una imagen RGBA de un solo canal repetido. */
const gray = (values: number[]) => {
  const data = new Uint8ClampedArray(values.length * 4)
  values.forEach((v, i) => { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255 })
  return data
}

describe('preparación de la imagen del ticket', () => {
  it('estima la resolución útil en píxeles por letra', () => {
    expect(imageQuality(1080)).toMatchObject({ level: 'buena', warning: null })
    expect(imageQuality(450)).toMatchObject({ level: 'baja', pixelsPerChar: 10.2 })
    expect(imageQuality(300)).toMatchObject({ level: 'insuficiente' })
  })
  it('una captura (negro sobre blanco) no se retoca; una foto gris de poco contraste, sí', () => {
    const screenshot = gray([...Array(98).fill(255), 20, 20])
    const photo = gray([...Array(90).fill(200), ...Array(10).fill(110)])
    expect(needsEnhancement(luminanceRange(screenshot))).toBe(false)
    expect(luminanceRange(photo)).toEqual({ low: 110, high: 200 })
    expect(needsEnhancement(luminanceRange(photo))).toBe(true)
    // Una imagen uniforme no se «estira»: no hay texto que realzar.
    expect(needsEnhancement(luminanceRange(gray(Array(50).fill(180))))).toBe(false)
  })
  it('estira el contraste a 0-255 y pasa a escala de grises', () => {
    const data = gray([110, 155, 200, 200])
    enhanceForOcr(data, 4, 1, { low: 110, high: 200 }, false)
    expect([data[0], data[4], data[8]]).toEqual([0, 128, 255])
    expect(data[3]).toBe(255)
  })
  it('el enfoque realza el borde entre texto y papel sin salirse de 0-255', () => {
    const data = gray([200, 200, 200, 110, 110, 110])
    enhanceForOcr(data, 6, 1, { low: 110, high: 200 }, true)
    const values = [0, 1, 2, 3, 4, 5].map(i => data[i * 4])
    expect(values[2]).toBe(255)
    expect(values[3]).toBe(0)
    expect(values.every(v => v >= 0 && v <= 255)).toBe(true)
  })
  it('las capturas largas se dividen en franjas que se solapan 128 px sin reducir la anchura', () => {
    const layout = imageLayout(1080, 9000)
    expect(layout.width).toBe(1300)
    expect(layout.offsets.every((y, i) => i === 0 || y - layout.offsets[i - 1] === 4096 - 128)).toBe(true)
    expect(layout.offsets.at(-1)! + 4096).toBeGreaterThanOrEqual(layout.height)
  })
})

describe('girar sin un lienzo del tamaño de la imagen', () => {
  // Una imagen de 4 × 3 con un valor distinto en cada píxel, y la misma girada como la gira un lienzo
  // (en el sentido de las agujas del reloj), píxel a píxel.
  const W = 4
  const H = 3
  const original = (u: number, v: number) => v * W + u
  const rotated = (rotation: TicketImageOptions['rotation'], x: number, y: number) =>
    rotation === 0 ? original(x, y) : rotation === 90 ? original(y, H - 1 - x) : rotation === 180 ? original(W - 1 - x, H - 1 - y) : original(W - 1 - y, x)
  const pixels = (rect: { x: number; y: number; width: number; height: number }, at: (x: number, y: number) => number) => {
    const values: number[] = []
    for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) values.push(at(x, y))
    return values.sort((a, b) => a - b)
  }
  it.each([0, 90, 180, 270] as const)('un trozo de la imagen girada %i° sale del mismo trozo de la original', (rotation) => {
    const [width, height] = rotation % 180 ? [H, W] : [W, H]
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      for (let h = 1; y + h <= height; h++) for (let w = 1; x + w <= width; w++) {
        const rect = { x, y, width: w, height: h }
        const source = rotatedSourceRect(rotation, W, H, rect)
        expect(pixels(source, original), `${rotation}° ${JSON.stringify(rect)}`).toEqual(pixels(rect, (a, b) => rotated(rotation, a, b)))
      }
    }
  })
})

// Estas dos venían de los tests del dominio (ticketFixtures y el caso 14 de ticketCases), con
// el mismo nombre: prueban código de la web, y shared/ no puede importar nada de src/.
describe('fixtures identificadas por procedencia', () => {
  it('segmenta una captura larga conservando la anchura y un solape de 128 px', () => {
    const layout = imageLayout(650, 12000)
    expect(layout.width).toBe(1300)
    expect(layout.height).toBe(24000)
    expect(layout.offsets[1]).toBe(3968)
    expect(layout.offsets).toHaveLength(7)
    expect(imageLayout(200, 1000).width).toBe(800)
  })
})

describe('14. Imagen de resolución insuficiente', () => {
  it('se avisa antes de leer según los píxeles por letra', () => {
    expect(imageQuality(1080).level).toBe('buena')
    expect(imageQuality(400)).toMatchObject({ level: 'baja' })
    expect(imageQuality(280)).toMatchObject({ level: 'insuficiente' })
    expect(imageQuality(280).warning).toContain('muy poca resolución')
  })
})
