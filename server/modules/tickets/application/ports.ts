import type { ISODate } from '#shared/common/types.ts'
import type { PantryEvent, PantryItem, PantryItemInput } from '#shared/pantry/types.ts'
import type { AliasRecord } from '#shared/tickets/ticketMatch.ts'
import type {
  OcrLine,
  PantryTicket,
  PantryTicketSummary,
  TicketAdjustment,
  TicketEvidence,
  TicketSegment,
  TicketStoreKind,
  TicketTaxCode,
} from '#shared/tickets/types.ts'
import type { PurchaseLine } from '../domain/purchaseHistory.ts'

/** Puertos del módulo tickets. Todo síncrono salvo el OCR, que es lo único asíncrono de verdad. */

/** Un ticket nuevo, tal como se guarda (sin sus líneas). */
export interface TicketToInsert {
  id: string
  store: TicketStoreKind
  storeName: string
  address: string
  date: ISODate
  time: string | null
  totalCents: number | null
  /** Huella del contenido: impide guardar el mismo ticket dos veces (índice único). */
  fingerprint: string
  createdAt: string
  adjustments: TicketAdjustment[]
  issues: string[]
  importId: string | null
  sourceFingerprint: string | null
}

/** Una línea nueva, tal como venía en el ticket, con su producto (null = no se sigue). */
export interface LineToInsert {
  id: string
  ticketId: string
  position: number
  rawName: string
  nameKey: string
  quantity: number
  unitPriceCents: number | null
  amountCents: number | null
  discountCents: number
  weightKg: number | null
  pricePerKgCents: number | null
  taxCode: TicketTaxCode | null
  itemId: string | null
  occasional: boolean
  reviewStatus: 'verified' | 'pending'
  confirmed: boolean
  evidence: TicketEvidence | undefined
}

/** Una línea guardada y su nombre normalizado (para cambiar a la vez todas las iguales). */
export interface StoredLineRef {
  id: string
  nameKey: string
}

/** Tickets guardados, sus líneas y lo aprendido en cada tienda. */
export interface TicketRepository {
  /** Lo aprendido en una tienda (ver aliasStoreOf): nombre normalizado → producto, o null si no se sigue. */
  aliases(aliasStore: string): AliasRecord[]
  upsertAlias(aliasStore: string, nameKey: string, itemId: string | null, now: string): void

  /** El ticket guardado desde esa misma lectura (importId) o desde el mismo origen (huella del texto o las imágenes). */
  findByImport(importId: string, sourceFingerprint: string): PantryTicketSummary | null
  findByFingerprint(fingerprint: string): PantryTicketSummary | null
  /** Tickets de esa fecha y ese total (el total puede ser null). */
  candidates(date: ISODate, totalCents: number | null): PantryTicketSummary[]
  /** Los últimos, por fecha y hora de compra. */
  listSummaries(limit: number): PantryTicketSummary[]
  getSummary(id: string): PantryTicketSummary | null
  /** Con sus líneas en orden, sus ajustes y sus avisos. */
  getTicket(id: string): PantryTicket | null
  getLine(ticketId: string, lineId: string): StoredLineRef | null
  linesOf(ticketId: string): StoredLineRef[]

  insertTicket(ticket: TicketToInsert): void
  insertLine(line: LineToInsert): void
  setLineItem(lineId: string, itemId: string | null): void
  /** Sus líneas se borran en cascada. */
  deleteTicket(id: string): void

  /** Las líneas que cuentan para el ritmo desde una fecha (con producto, verificadas y no «para una ocasión»). */
  purchaseLinesSince(date: ISODate): PurchaseLine[]

  /** Vacía los tickets y lo aprendido (solo para las pruebas). */
  reset(): void
}

/** Lee el texto de las imágenes de un ticket, en este mismo equipo. */
export interface TicketReader {
  /** Una lista de líneas por imagen (o franja), en orden. Las imágenes ya vienen validadas (PNG o JPEG). */
  read(images: readonly Uint8Array[], segments?: readonly Omit<TicketSegment, 'image'>[]): Promise<OcrLine[][]>
  close(): Promise<void>
}

/** Lo que tickets usa de la despensa. server/app.ts le pasa la API pública del módulo pantry. */
export interface PantryGateway {
  getItem(id: string): PantryItem | null
  createItem(input: PantryItemInput): PantryItem
  /** Precio nuevo y, si el producto se cuenta, lo comprado. */
  applyTicketPurchase(id: string, purchase: { priceCents: number | null; addQuantity: number | null }): void
  listItems(): PantryItem[]
  eventsSince(date: ISODate): PantryEvent[]
}

/** SHA-256 en hexadecimal de las partes, una detrás de otra (el texto, en UTF-8). */
export interface Hasher {
  sha256Hex(parts: readonly (string | Uint8Array)[]): string
}
