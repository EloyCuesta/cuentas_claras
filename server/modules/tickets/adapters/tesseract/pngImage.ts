import { deflateSync, inflateSync } from 'node:zlib'

/**
 * PNG en gris, sin dependencias (node:zlib): decodificar una franja, recortar
 * y reescalar un trozo y volver a codificarlo. Lo usa el lector para leer la
 * banda de importes otra vez a otra escala: una lectura independiente para
 * votar el importe. Solo PNG de 8 bits sin entrelazar (lo que da un canvas);
 * con cualquier otra cosa devuelve null y el lector no vota.
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

/** Un PNG a gris (0-255), o null si no es un PNG que se sepa leer. */
export function decodePngGray(png: Uint8Array): Gray | null {
  const buffer = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(SIGNATURE)) return null
  let width = 0
  let height = 0
  let channels = 0
  const chunks: Buffer[] = []
  for (let at = 8; at + 8 <= buffer.length;) {
    const length = buffer.readUInt32BE(at)
    const type = buffer.toString('latin1', at + 4, at + 8)
    const body = buffer.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      channels = CHANNELS[body[9]] ?? 0
      if (body[8] !== 8 || body[12] !== 0 || channels === 0) return null
    } else if (type === 'IDAT') chunks.push(body)
    else if (type === 'IEND') break
    at += 12 + length
  }
  if (!width || !height) return null
  let raw: Buffer
  try {
    raw = inflateSync(Buffer.concat(chunks))
  } catch {
    return null
  }
  const stride = width * channels
  if (raw.length < height * (stride + 1)) return null
  const gray = new Uint8Array(width * height)
  let previous = new Uint8Array(stride)
  let row = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels] : 0
      const up = previous[i]
      const corner = i >= channels ? previous[i - channels] : 0
      const value = line[i]
      row[i] = filter === 1 ? value + left : filter === 2 ? value + up : filter === 3 ? value + ((left + up) >> 1) : filter === 4 ? value + paeth(left, up, corner) : value
    }
    for (let x = 0; x < width; x++) {
      const p = x * channels
      gray[y * width + x] = channels >= 3 ? (row[p] * 299 + row[p + 1] * 587 + row[p + 2] * 114) / 1000 : row[p]
    }
    ;[previous, row] = [row, previous]
  }
  return { width, height, data: gray }
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
