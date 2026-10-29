import { describe, expect, it } from 'vitest'
import { enhanceForOcr, imageLayout, imageQuality, luminanceRange, needsEnhancement } from './ticketImages.ts'

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
