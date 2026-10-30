import { isValidISODate, todayISO } from '../../shared/core/dates.ts'
import type { ISODate } from '../../shared/core/types.ts'
import { validateSegmentLayout, type SegmentPosition } from '../../shared/tickets/validation.ts'
import { AppError } from '../infra/errors.ts'
import { readBody, valid } from '../infra/http.ts'
import { imageInfo } from './imageInfo.ts'

/**
 * Lo que llega a POST /api/despensa/tickets/leer, ya comprobado: el texto
 * pegado, unas capturas enteras o las franjas de capturas largas.
 */
export type TicketReadRequest = { today: ISODate } & (
  | { kind: 'text'; text: string }
  | { kind: 'images'; images: Buffer[]; segments?: SegmentPosition[] }
)

const MAX_IMAGES = 6
const MAX_SEGMENTS = 24
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_BYTES = 20 * 1024 * 1024
const MAX_PIXELS = 40_000_000
const MAX_TEXT = 20_000

/** Imágenes en base64 → Buffer, comprobando número, tamaño y formato (PNG o JPEG). */
function decodeImages(value: unknown, max = MAX_IMAGES): Buffer[] {
  if (!Array.isArray(value) || value.length === 0) throw new AppError('VALIDATION', 'Elige al menos una imagen del ticket.')
  if (value.length > max) throw new AppError('VALIDATION', `Se pueden leer como máximo ${max} imágenes o franjas de un mismo ticket.`)
  let bytes = 0
  return value.map((item, i) => {
    if (typeof item !== 'string' || item.length === 0) throw new AppError('VALIDATION', `La imagen ${i + 1} no es válida.`)
    const buffer = Buffer.from(item.replace(/^data:[^,]*,/, ''), 'base64')
    bytes += buffer.length
    if (bytes > MAX_TOTAL_BYTES) throw new AppError('VALIDATION', 'Las imágenes superan 20 MB. Recorta los márgenes o el contenido publicitario.')
    if (buffer.length > MAX_IMAGE_BYTES) throw new AppError('VALIDATION', `La imagen ${i + 1} es demasiado grande (máximo 8 MB).`)
    const info = imageInfo(buffer)
    if (!info) throw new AppError('VALIDATION', `La imagen ${i + 1} no es una imagen PNG o JPEG.`)
    if (info.width * info.height > MAX_PIXELS || info.width > 8000 || info.height > 40000) {
      throw new AppError('VALIDATION', `La imagen ${i + 1} es demasiado grande para leerla.`)
    }
    return buffer
  })
}

export function parseTicketReadRequest(rawBody: unknown): TicketReadRequest {
  const body = readBody(rawBody)
  const today = isValidISODate(body.hoy) ? body.hoy : todayISO()

  if (typeof body.texto === 'string') {
    if (body.texto.trim() === '') throw new AppError('VALIDATION', 'Pega el texto del ticket.')
    if (body.texto.length > MAX_TEXT) throw new AppError('VALIDATION', 'El texto del ticket es demasiado largo.')
    return { kind: 'text', text: body.texto, today }
  }

  if (Array.isArray(body.franjas)) {
    const raw: unknown[] = body.franjas
    const images = decodeImages(
      raw.map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>).image : null)),
      MAX_SEGMENTS,
    )
    // decodeImages ya ha comprobado que cada una es PNG o JPEG.
    const sizes = images.map((image) => imageInfo(image) as { width: number; height: number })
    return { kind: 'images', images, segments: valid(validateSegmentLayout(raw, sizes)), today }
  }

  return { kind: 'images', images: decodeImages(body.imagenes), today }
}
