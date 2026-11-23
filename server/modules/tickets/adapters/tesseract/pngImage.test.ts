import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { imageInfo } from '../../../../common/imageInfo.ts'
import { decodePngGray, encodeGrayPng, scaleRegion, type Gray } from './pngImage.ts'

const gradient = (width: number, height: number): Gray => {
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = (x * 7 + y * 13) % 256
  return { width, height, data }
}

/** Un PNG a mano, bloque a bloque (el decodificador no comprueba el CRC). */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const chunk = (type: string, body: Buffer, length = body.length) => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(length, 0)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, body, Buffer.alloc(4)])
}
const ihdr = (width: number, height: number, { depth = 8, color = 0, interlace = 0 } = {}) => {
  const body = Buffer.alloc(13)
  body.writeUInt32BE(width, 0)
  body.writeUInt32BE(height, 4)
  body[8] = depth
  body[9] = color
  body[12] = interlace
  return chunk('IHDR', body)
}
/** Las filas de una imagen en gris de `width` × `height`, cada una con su byte de filtro. */
const rows = (width: number, height: number, filter = 0) => {
  const raw = Buffer.alloc(height * (width + 1), 0x80)
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = filter
  return raw
}
const png = (...chunks: Buffer[]) => Buffer.concat([SIGNATURE, ...chunks, chunk('IEND', Buffer.alloc(0))])

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

  it('un PNG malformado da null, sin lanzar', () => {
    const idat = chunk('IDAT', deflateSync(rows(37, 19)))
    // El bueno, para comparar: con estos mismos bloques sí se lee.
    expect(decodePngGray(png(ihdr(37, 19), idat))).toMatchObject({ width: 37, height: 19 })
    // Un IHDR corto.
    expect(decodePngGray(png(chunk('IHDR', Buffer.alloc(4)), idat, chunk('IDAT', Buffer.alloc(20))))).toBeNull()
    // Dos IHDR: la petición se valida con el primero (1 × 1); el segundo no puede cambiar el tamaño.
    expect(decodePngGray(png(ihdr(1, 1), ihdr(37, 19), idat))).toBeNull()
    // El IHDR no es el primer bloque.
    expect(decodePngGray(png(chunk('tEXt', Buffer.from('a\0b')), ihdr(37, 19), idat))).toBeNull()
    // Un bloque que dice ser más largo que el archivo.
    expect(decodePngGray(png(ihdr(37, 19), chunk('IDAT', deflateSync(rows(37, 19)), 1_000_000)))).toBeNull()
    // Sin IDAT, con un filtro de fila que no existe, en 16 bits, entrelazado o con paleta.
    expect(decodePngGray(png(ihdr(37, 19)))).toBeNull()
    expect(decodePngGray(png(ihdr(37, 19), chunk('IDAT', deflateSync(rows(37, 19, 5)))))).toBeNull()
    expect(decodePngGray(png(ihdr(37, 19, { depth: 16 }), idat))).toBeNull()
    expect(decodePngGray(png(ihdr(37, 19, { interlace: 1 }), idat))).toBeNull()
    expect(decodePngGray(png(ihdr(37, 19, { color: 3 }), idat))).toBeNull()
    // Más filas de las que dice la cabecera, o menos.
    expect(decodePngGray(png(ihdr(37, 19), chunk('IDAT', deflateSync(rows(37, 20)))))).toBeNull()
    expect(decodePngGray(png(ihdr(37, 19), chunk('IDAT', deflateSync(rows(37, 18)))))).toBeNull()
  })

  it('no pasa de los límites de la lectura: 8000 px de ancho, 40 000 de alto y 40 millones de píxeles', () => {
    expect(decodePngGray(png(ihdr(8000, 2), chunk('IDAT', deflateSync(rows(8000, 2)))))).toMatchObject({ width: 8000, height: 2 })
    expect(decodePngGray(png(ihdr(8001, 2), chunk('IDAT', deflateSync(rows(8001, 2)))))).toBeNull()
    expect(decodePngGray(png(ihdr(1, 40001), chunk('IDAT', deflateSync(rows(1, 40001)))))).toBeNull()
    expect(decodePngGray(png(ihdr(8000, 5001), chunk('IDAT', deflateSync(rows(1, 1)))))).toBeNull()
  })

  it('una «bomba» de compresión no se descomprime más allá de lo que dice la cabecera', () => {
    // 64 MB de ceros caben en unos 64 kB comprimidos; la cabecera dice 100 × 100 (10 100 bytes de filas).
    const bomb = deflateSync(Buffer.alloc(64 * 1024 * 1024))
    expect(bomb.length).toBeLessThan(100_000)
    expect(decodePngGray(png(ihdr(100, 100), chunk('IDAT', bomb)))).toBeNull()
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
