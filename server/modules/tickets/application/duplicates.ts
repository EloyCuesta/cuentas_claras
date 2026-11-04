import type { PantryTicket, PantryTicketSummary, TicketSaveInput } from '#shared/tickets/types.ts'
import { aliasStoreOf, fingerprintSource, type FingerprintInput } from '../domain/ticketIdentity.ts'
import type { Hasher, TicketRepository } from './ports.ts'

/** Lo que identifica un ticket y de dónde se leyó. */
export type DuplicateInput = FingerprintInput & Pick<TicketSaveInput, 'importId' | 'sourceFingerprint'>

export function ticketFingerprint(hasher: Hasher, input: FingerprintInput): string {
  return hasher.sha256Hex([fingerprintSource(input)])
}

/**
 * El mismo ticket, si ya está guardado: desde la misma lectura o el mismo
 * origen, con la misma huella o, en los guardados con una huella anterior,
 * con el mismo contenido (entonces se devuelve el ticket entero, con sus líneas).
 */
export async function findDuplicate(
  repository: TicketRepository,
  hasher: Hasher,
  input: DuplicateInput,
): Promise<PantryTicketSummary | PantryTicket | null> {
  const fingerprint = ticketFingerprint(hasher, input)
  const found =
    (await repository.findByImport(input.importId ?? '', input.sourceFingerprint ?? '')) ??
    (await repository.findByFingerprint(fingerprint))
  if (found) return found
  // Los tickets guardados con una huella anterior la conservan: se compara su contenido.
  for (const candidate of await repository.candidates(input.date, input.totalCents)) {
    const saved = await repository.getTicket(candidate.id)
    if (saved && ticketFingerprint(hasher, { ...saved, store: candidate.store }) === fingerprint) return saved
  }
  return null
}

/**
 * Otra compra en la misma tienda, con la misma fecha y el mismo total, a la
 * misma hora (o sin hora en alguna de las dos): puede ser el mismo ticket leído
 * de otra forma, y hay que confirmarlo.
 */
export async function possibleDuplicate(
  repository: TicketRepository,
  input: Pick<DuplicateInput, 'store' | 'storeName' | 'date' | 'time' | 'totalCents'>,
): Promise<PantryTicketSummary | null> {
  const store = aliasStoreOf(input.store, input.storeName)
  const sameTime = (time: string | null) => time === input.time || time === null || input.time === null
  const candidates = await repository.candidates(input.date, input.totalCents)
  return candidates.find((s) => aliasStoreOf(s.store, s.storeName) === store && sameTime(s.time)) ?? null
}
