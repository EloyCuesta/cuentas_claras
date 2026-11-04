import { isValidISODate } from '#shared/common/dates.ts'
import type { ISODate } from '#shared/common/types.ts'
import type { TicketSegment } from '#shared/tickets/types.ts'
import { AppError } from '../../../../common/errors.ts'
import { imageInfo } from '../../../../common/imageInfo.ts'
import type { TicketSourceInput } from '../../application/ReadTicket.ts'

/**
 * El cuerpo de POST /api/despensa/tickets/leer, decodificado y validado antes
 * de leer nada:
 * - { texto }: el texto pegado (no vacío, hasta 20 000 caracteres).
 * - { franjas }: hasta 24 franjas de hasta 6 imágenes largas, con sus
 *   coordenadas, ordenadas y de la misma imagen (las prepara el navegador).
 * - { imagenes }: hasta 6 capturas.
 * Las imágenes: PNG o JPEG (por su cabecera), hasta 8 MB cada una, 20 MB en
 * total y 40 Mpx. Y `hoy`, la fecha del navegador, si es válida.
 */

const MAX_IMAGES = 6
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_PIXELS = 40_000_000
const MAX_TEXT = 20_000

function decodeImages(value: unknown, max = MAX_IMAGES): Buffer[] {
  if (!Array.isArray(value) || value.length === 0) throw new AppError('VALIDATION', 'Elige al menos una imagen del ticket.')
  if (value.length > max) throw new AppError('VALIDATION', `Se pueden leer como máximo ${max} imágenes o franjas de un mismo ticket.`)
  let bytes = 0
  return value.map((item, i) => {
    if (typeof item !== 'string' || item.length === 0) throw new AppError('VALIDATION', `La imagen ${i + 1} no es válida.`)
    const buffer = Buffer.from(item.replace(/^data:[^,]*,/, ''), 'base64')
    bytes += buffer.length
    if (bytes > 20 * 1024 * 1024) throw new AppError('VALIDATION', 'Las imágenes superan 20 MB. Recorta los márgenes o el contenido publicitario.')
    if (buffer.length > MAX_IMAGE_BYTES) throw new AppError('VALIDATION', `La imagen ${i + 1} es demasiado grande (máximo 8 MB).`)
    const info = imageInfo(buffer)
    if (!info) throw new AppError('VALIDATION', `La imagen ${i + 1} no es una imagen PNG o JPEG.`)
    if (info.width * info.height > MAX_PIXELS || info.width > 8000 || info.height > 40000) {
      throw new AppError('VALIDATION', `La imagen ${i + 1} es demasiado grande para leerla.`)
    }
    return buffer
  })
}

/** Coordenadas de cada franja: van seguidas, sin huecos, y son de la misma imagen que la anterior. */
function readSegments(franjas: unknown[], images: readonly Buffer[]): Omit<TicketSegment, 'image'>[] {
  const previous = new Map<number, { segment: number; offset: number; width: number; height: number }>()
  return franjas.map((raw, i) => {
    // decodeImages ya ha comprobado que cada franja es un objeto con su imagen.
    const { imageIndex, segmentIndex, offsetY, fullHeight } = raw as Record<string, unknown>
    if (
      ![imageIndex, segmentIndex, offsetY, fullHeight].every(Number.isSafeInteger) ||
      Number(imageIndex) < 0 ||
      Number(imageIndex) > 5 ||
      Number(segmentIndex) < 0 ||
      Number(segmentIndex) > 23 ||
      Number(offsetY) < 0 ||
      Number(fullHeight) < 1 ||
      Number(fullHeight) > 160000
    ) {
      throw new AppError('VALIDATION', 'Las coordenadas de las franjas no son válidas.')
    }
    const info = imageInfo(images[i])!
    const prev = previous.get(Number(imageIndex))
    if (
      info.height > 4096 ||
      Number(offsetY) + info.height > Number(fullHeight) ||
      (prev
        ? Number(segmentIndex) !== prev.segment + 1 ||
          Number(offsetY) <= prev.offset ||
          info.width !== prev.width ||
          Number(fullHeight) !== prev.height
        : segmentIndex !== 0 || offsetY !== 0)
    ) {
      throw new AppError('VALIDATION', 'Las franjas deben estar ordenadas y pertenecer a la misma imagen.')
    }
    previous.set(Number(imageIndex), { segment: Number(segmentIndex), offset: Number(offsetY), width: info.width, height: Number(fullHeight) })
    return { imageIndex: Number(imageIndex), segmentIndex: Number(segmentIndex), offsetY: Number(offsetY), fullHeight: Number(fullHeight) }
  })
}

export function readTicketRequest(body: Record<string, unknown>): { source: TicketSourceInput; today: ISODate | null } {
  const today = isValidISODate(body.hoy) ? body.hoy : null
  if (typeof body.texto === 'string') {
    if (body.texto.trim() === '') throw new AppError('VALIDATION', 'Pega el texto del ticket.')
    if (body.texto.length > MAX_TEXT) throw new AppError('VALIDATION', 'El texto del ticket es demasiado largo.')
    return { source: { kind: 'texto', text: body.texto }, today }
  }
  if (Array.isArray(body.franjas)) {
    const images = decodeImages(
      body.franjas.map((f: unknown) => (f && typeof f === 'object' ? (f as Record<string, unknown>).image : null)),
      24,
    )
    return { source: { kind: 'imagenes', images, segments: readSegments(body.franjas, images) }, today }
  }
  return { source: { kind: 'imagenes', images: decodeImages(body.imagenes) }, today }
}
