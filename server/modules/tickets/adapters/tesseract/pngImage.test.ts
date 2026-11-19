import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { imageInfo } from '../../../../common/imageInfo.ts'
import { decodePngGray, encodeGrayPng, scaleRegion, type Gray } from './pngImage.ts'

const gradient = (width: number, height: number): Gray => {
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = (x * 7 + y * 13) % 256
  return { width, height, data }
}

describe('PNG en gris para la tercera lectura del lector', () => {
  it('lo que codifica lo vuelve a leer igual', () => {
    const image = gradient(37, 19)
    const png = encodeGrayPng(image)
    expect(imageInfo(png)).toMatchObject({ type: 'png', width: 37, height: 19 })
    expect(decodePngGray(png)).toEqual(image)
  })

  it('lee una captura real de un navegador (color, filtros de fila) con sus tonos', () => {
    const png = readFileSync(new URL('../../../../../fixtures/tickets/banco/mediano-captura-1.png', import.meta.url))
    const gray = decodePngGray(png)!
    expect(gray).toMatchObject({ width: 1080, height: 2400 })
    // La barra de estado es blanca, y la hora, oscura.
    expect(gray.data[10 * 1080 + 540]).toBe(255)
    expect(Math.min(...gray.data.subarray(40 * 1080, 41 * 1080))).toBeLessThan(80)
  })

  it('no lee lo que no es un PNG de 8 bits', () => {
    expect(decodePngGray(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(decodePngGray(readFileSync(new URL('../../../../../fixtures/tickets/ticket-lidl-ejemplo.png', import.meta.url)).subarray(0, 40))).toBeNull()
  })

  it('reescala un trozo: la mitad promedia, el doble interpola', () => {
    const image: Gray = { width: 4, height: 2, data: Uint8Array.from([0, 100, 200, 255, 0, 100, 200, 255]) }
    expect(scaleRegion(image, 0, 0, 4, 2, 0.5)).toEqual({ width: 2, height: 1, data: Uint8Array.from([50, 227]) })
    const double = scaleRegion(image, 1, 0, 2, 1, 2)
    expect(double).toMatchObject({ width: 4, height: 2 })
    // En los bordes del trozo se usan los píxeles vecinos de la imagen (0 a la izquierda, 255 a la derecha).
    expect([...double.data.subarray(0, 4)]).toEqual([75, 125, 175, 213])
  })
})
