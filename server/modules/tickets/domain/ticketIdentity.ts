import type { ISODate } from '#shared/common/types.ts'
import { nameKey } from '#shared/tickets/ticketText.ts'
import type { TicketAdjustment, TicketSaveLine, TicketStoreKind } from '#shared/tickets/types.ts'

/**
 * Qué identifica un ticket: la tienda donde se aprende lo que es cada nombre y
 * el texto del que sale la huella (SHA-256) que impide guardarlo dos veces.
 *
 * No cambies estos textos: las huellas ya guardadas dejarían de coincidir y un
 * ticket repetido no se reconocería («las huellas no cambian», en tickets.test.ts).
 */

/** Las equivalencias se aprenden por tienda: Lidl, o el nombre de cada otra tienda. */
export function aliasStoreOf(store: TicketStoreKind, storeName: string): string {
  return store === 'lidl' ? 'lidl' : `otra:${nameKey(storeName)}`
}

type FingerprintLine = Pick<
  TicketSaveLine,
  'rawName' | 'quantity' | 'unitPriceCents' | 'amountCents' | 'discountCents' | 'weightKg' | 'pricePerKgCents'
>

/** Lo que entra en la huella de un ticket guardado. */
export interface FingerprintInput {
  store: TicketStoreKind
  storeName: string
  date: ISODate
  time: string | null
  totalCents: number | null
  lines: readonly FingerprintLine[]
  adjustments?: readonly Pick<TicketAdjustment, 'kind' | 'amountCents'>[]
}

/** Tienda, fecha, hora, total, líneas y ajustes, sin que importe el orden de las líneas ni de los ajustes. */
export function fingerprintSource(input: FingerprintInput): string {
  const lines = input.lines
    .map((l) => [
      nameKey(l.rawName),
      l.quantity,
      l.unitPriceCents,
      l.amountCents,
      l.discountCents,
      l.weightKg === null ? null : Math.round(l.weightKg * 1000),
      l.pricePerKgCents,
    ])
    .map((l) => JSON.stringify(l))
    .sort()
  const adjustments = (input.adjustments ?? [])
    .map((a) => [a.kind, a.amountCents])
    .map((a) => JSON.stringify(a))
    .sort()
  return JSON.stringify([aliasStoreOf(input.store, input.storeName), input.date, input.time, input.totalCents, lines, adjustments])
}

/** Huella del texto pegado: el mismo texto con otros espacios o saltos de línea es el mismo ticket. */
export function pastedTextSource(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim()
}

/** Huella de las imágenes leídas: cada una, con su tamaño delante, byte a byte y en orden. */
export function imagesSource(images: readonly Uint8Array[]): (string | Uint8Array)[] {
  return images.flatMap((image) => [String(image.length), image])
}
