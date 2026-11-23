import { createInflate, deflateSync, inflateSync } from 'node:zlib'
import { IMAGE_LIMITS } from '../../../../common/imageInfo.ts'

/**
 * PNG en gris, sin dependencias (node:zlib): decodificar una franja, recortar
 * y reescalar un trozo y volver a codificarlo. Lo usa el lector para leer la
 * banda de importes otra vez a otra escala: una lectura independiente para
 * votar el importe. Solo PNG de 8 bits sin entrelazar (lo que da un canvas);
 * con cualquier otra cosa devuelve null y el lector no vota.
 *
 * La ruta de lectura es pública, así que el decodificador no se fía de nada:
 * usa solo la cabecera que validó la petición (el primer bloque, un IHDR de 13
 * bytes, y uno solo), con los mismos límites (IMAGE_LIMITS), y nunca
 * descomprime más de lo que dice esa cabecera. Cualquier cosa rara da null.
 *
 * El lector usa decodePngRows: solo las filas de la banda que relee, y la
 * descompresión por partes, en el hilo de zlib (no bloquea Express). Una franja
 * puede tener hasta 8000 × 4096 píxeles en color (131 MB descomprimida): así no
 * se guarda nunca entera. decodePngGray, la imagen entera de una vez, queda para
 * las pruebas.
 */

export interface Gray {
  width: number
  height: number
  data: Uint8Array
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Firma (8) + longitud, tipo, cuerpo de 13 bytes y CRC del IHDR (25). */
const HEADER_END = 8 + 25

interface PngHeader {
  width: number
  height: number
  channels: number
  /** Bytes de una fila sin su byte de filtro. */
  stride: number
  /** Los bloques IDAT, juntos y aún comprimidos. */
  compressed: Buffer
}

/** La cabecera y los datos comprimidos, o null si no es un PNG que se sepa leer o viene malformado. */
function readPng(png: Uint8Array): PngHeader | null {
  const buffer = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
  if (buffer.length < HEADER_END || !buffer.subarray(0, 8).equals(SIGNATURE)) return null
  // El primer bloque es el IHDR, de 13 bytes: el mismo que lee imageInfo al validar la petición.
  if (buffer.readUInt32BE(8) !== 13 || buffer.toString('latin1', 12, 16) !== 'IHDR') return null
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const [depth, color, compression, filterMethod, interlace] = buffer.subarray(24, 29)
  const channels = CHANNELS[color] ?? 0
  if (depth !== 8 || channels === 0 || compression !== 0 || filterMethod !== 0 || interlace !== 0) return null
  if (width === 0 || height === 0 || width > IMAGE_LIMITS.maxWidth || height > IMAGE_LIMITS.maxHeight || width * height > IMAGE_LIMITS.maxPixels) return null
  const chunks: Buffer[] = []
  for (let at = HEADER_END; at + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(at)
    if (at + 12 + length > buffer.length) return null
    const type = buffer.toString('latin1', at + 4, at + 8)
    // Otro IHDR cambiaría el tamaño que se validó.
    if (type === 'IHDR') return null
    if (type === 'IDAT') chunks.push(buffer.subarray(at + 8, at + 8 + length))
    at += 12 + length
    if (type === 'IEND') break
  }
  if (chunks.length === 0) return null
  return { width, height, channels, stride: width * channels, compressed: Buffer.concat(chunks) }
}

/**
 * Deshace el filtro de una fila (`line`, sin su byte de filtro) con la anterior ya deshecha, en `row`.
 * false si el filtro no existe.
 */
function unfilter(filter: number, line: Uint8Array, previous: Uint8Array, row: Uint8Array, channels: number): boolean {
  if (filter > 4) return false
  for (let i = 0; i < line.length; i++) {
    const left = i >= channels ? row[i - channels] : 0
    const up = previous[i]
    const corner = i >= channels ? previous[i - channels] : 0
    const value = line[i]
    row[i] = filter === 1 ? value + left : filter === 2 ? value + up : filter === 3 ? value + ((left + up) >> 1) : filter === 4 ? value + paeth(left, up, corner) : value
  }
  return true
}

/** Una fila ya deshecha, en gris, a partir de `at` de `gray`. */
function grayRow(row: Uint8Array, gray: Uint8Array, at: number, width: number, channels: number): void {
  for (let x = 0; x < width; x++) {
    const p = x * channels
    gray[at + x] = channels >= 3 ? (row[p] * 299 + row[p + 1] * 587 + row[p + 2] * 114) / 1000 : row[p]
  }
}

/** Un PNG entero a gris (0-255), de una vez, o null si no es un PNG que se sepa leer o viene malformado. */
export function decodePngGray(png: Uint8Array): Gray | null {
  const header = readPng(png)
  if (!header) return null
  const { width, height, channels, stride } = header
  // Lo que ocupan las filas, cada una con su byte de filtro: ni un byte más (una «bomba» de compresión se corta aquí).
  const expected = height * (stride + 1)
  let raw: Buffer
  try {
    raw = inflateSync(header.compressed, { maxOutputLength: expected })
  } catch {
    return null
  }
  if (raw.length !== expected) return null
  const gray = new Uint8Array(width * height)
  let previous = new Uint8Array(stride)
  let row = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    if (!unfilter(raw[y * (stride + 1)], raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), previous, row, channels)) return null
    grayRow(row, gray, y * width, width, channels)
    ;[previous, row] = [row, previous]
  }
  return { width, height, data: gray }
}

/**
 * Solo las filas de `from` a `to` (sin incluir) de un PNG, en gris: { width, height: to - from }. Descomprime por
 * partes, en el hilo de zlib, y se para en cuanto tiene la última fila: nunca guarda la imagen entera ni descomprime
 * más de lo que hace falta. null si el PNG no se sabe leer, viene malformado o no llega a esas filas.
 */
export function decodePngRows(png: Uint8Array, from: number, to: number): Promise<Gray | null> {
  const header = readPng(png)
  if (!header || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > header.height || from >= to) return Promise.resolve(null)
  const { width, channels, stride } = header
  const gray = new Uint8Array(width * (to - from))
  let previous = new Uint8Array(stride)
  let row = new Uint8Array(stride)
  const pending = new Uint8Array(stride + 1)
  let filled = 0
  let y = 0
  return new Promise((resolve) => {
    const inflate = createInflate()
    let done = false
    const finish = (result: Gray | null) => {
      if (done) return
      done = true
      inflate.removeAllListeners('data')
      inflate.removeAllListeners('end')
      inflate.destroy()
      resolve(result)
    }
    inflate.on('data', (data: Buffer) => {
      for (let at = 0; at < data.length && !done;) {
        const take = Math.min(stride + 1 - filled, data.length - at)
        pending.set(data.subarray(at, at + take), filled)
        filled += take
        at += take
        if (filled < stride + 1) break
        filled = 0
        if (!unfilter(pending[0], pending.subarray(1), previous, row, channels)) return finish(null)
        if (y >= from) grayRow(row, gray, (y - from) * width, width, channels)
        ;[previous, row] = [row, previous]
        if (++y === to) return finish({ width, height: to - from, data: gray })
      }
    })
    // Un error de zlib o un final antes de la última fila pedida: el PNG no sirve.
    inflate.on('error', () => finish(null))
    inflate.on('end', () => finish(null))
    inflate.end(header.compressed)
  })
}

/** Un trozo de la imagen reescalado: media de cada caja al reducir, interpolación lineal al ampliar. */
export function scaleRegion(image: Gray, left: number, top: number, width: number, height: number, scale: number): Gray {
  const outWidth = Math.max(1, Math.round(width * scale))
  const outHeight = Math.max(1, Math.round(height * scale))
  const data = new Uint8Array(outWidth * outHeight)
  const at = (x: number, y: number) => image.data[Math.min(image.height - 1, Math.max(0, top + y)) * image.width + Math.min(image.width - 1, Math.max(0, left + x))]
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      if (scale < 1) {
        const x0 = Math.floor(x / scale)
        const y0 = Math.floor(y / scale)
        const x1 = Math.max(x0 + 1, Math.floor((x + 1) / scale))
        const y1 = Math.max(y0 + 1, Math.floor((y + 1) / scale))
        let sum = 0
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += at(xx, yy)
        data[y * outWidth + x] = sum / ((x1 - x0) * (y1 - y0))
      } else {
        const sx = (x + 0.5) / scale - 0.5
        const sy = (y + 0.5) / scale - 0.5
        const fx = Math.floor(sx)
        const fy = Math.floor(sy)
        const dx = sx - fx
        const dy = sy - fy
        data[y * outWidth + x] = (at(fx, fy) * (1 - dx) + at(fx + 1, fy) * dx) * (1 - dy) + (at(fx, fy + 1) * (1 - dx) + at(fx + 1, fy + 1) * dx) * dy
      }
    }
  }
  return { width: outWidth, height: outHeight, data }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Buffer): number {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, crc])
}

/** Gris a PNG de 8 bits. */
export function encodeGrayPng(image: Gray): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(image.width, 0)
  header.writeUInt32BE(image.height, 4)
  header[8] = 8
  header[9] = 0
  const raw = Buffer.alloc(image.height * (image.width + 1))
  for (let y = 0; y < image.height; y++) raw.set(image.data.subarray(y * image.width, (y + 1) * image.width), y * (image.width + 1) + 1)
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
