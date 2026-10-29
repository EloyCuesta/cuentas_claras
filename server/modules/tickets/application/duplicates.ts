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
export function findDuplicate(repository: TicketRepository, hasher: Hasher, input: DuplicateInput): PantryTicketSummary | PantryTicket | null {
  const fingerprint = ticketFingerprint(hasher, input)
  const found = repository.findByImport(input.importId ?? '', input.sourceFingerprint ?? '') ?? repository.findByFingerprint(fingerprint)
  if (found) return found
  // Los tickets guardados con una huella anterior la conservan: se compara su contenido.
  for (const candidate of repository.candidates(input.date, input.totalCents)) {
    const saved = repository.getTicket(candidate.id)
    if (saved && ticketFingerprint(hasher, { ...saved, store: candidate.store }) === fingerprint) return saved
  }
  return null
}

/**
 * Otra compra en la misma tienda, con la misma fecha y el mismo total, a la
 * misma hora (o sin hora en alguna de las dos): puede ser el mismo ticket leído
 * de otra forma, y hay que confirmarlo.
 */
export function possibleDuplicate(
  repository: TicketRepository,
  input: Pick<DuplicateInput, 'store' | 'storeName' | 'date' | 'time' | 'totalCents'>,
): PantryTicketSummary | null {
  const store = aliasStoreOf(input.store, input.storeName)
  return (
    repository
      .candidates(input.date, input.totalCents)
      .find((s) => aliasStoreOf(s.store, s.storeName) === store && (s.time === input.time || s.time === null || input.time === null)) ?? null
  )
}
