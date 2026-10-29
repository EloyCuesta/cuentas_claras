/**
 * Tipo y tamaño de una imagen PNG o JPEG leyendo solo su cabecera (sin
 * decodificarla). Sirve para rechazar archivos que no son imágenes o que son
 * demasiado grandes antes de pasarlos al lector de tickets.
 */

export interface ImageInfo {
  type: 'png' | 'jpeg'
  width: number
  height: number
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function pngInfo(buffer: Buffer): ImageInfo | null {
  if (buffer.length < 24 || !PNG_SIGNATURE.every((byte, i) => buffer[i] === byte)) return null
  // El primer bloque es IHDR: ancho y alto en los bytes 16-23.
  if (buffer.toString('latin1', 12, 16) !== 'IHDR') return null
  return { type: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/** Marcadores SOF (inicio de imagen) de JPEG que llevan el tamaño. */
const isStartOfFrame = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

function jpegInfo(buffer: Buffer): ImageInfo | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null
    const marker = buffer[offset + 1]
    if (marker === 0xff) {
      offset++ // relleno
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    if (marker === 0xd9) return null
    const length = buffer.readUInt16BE(offset + 2)
    if (length < 2) return null
    if (isStartOfFrame(marker)) {
      if (offset + 9 > buffer.length) return null
      return { type: 'jpeg', height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    }
    offset += 2 + length
  }
  return null
}

export function imageInfo(buffer: Buffer): ImageInfo | null {
  const info = pngInfo(buffer) ?? jpegInfo(buffer)
  return info && info.width > 0 && info.height > 0 ? info : null
}
