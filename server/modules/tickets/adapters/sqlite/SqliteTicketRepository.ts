import type Database from 'better-sqlite3'
import type { ISODate } from '#shared/common/types.ts'
import type { AliasRecord } from '#shared/tickets/ticketMatch.ts'
import type { PantryTicket, PantryTicketLine, PantryTicketSummary, TicketStoreKind, TicketTaxCode } from '#shared/tickets/types.ts'
import type { LineToInsert, StoredLineRef, TicketRepository, TicketToInsert } from '../../application/ports.ts'
import type { PurchaseLine } from '../../domain/purchaseHistory.ts'

/**
 * Tickets de la compra en SQLite (tablas pantry_tickets, pantry_ticket_lines y
 * pantry_aliases). Sin imágenes: solo los datos que la persona confirmó.
 *
 * Solo SQL y conversión de filas: qué es un duplicado, qué hace cada línea y
 * las transacciones (inmediatas) están en los casos de uso (application/).
 * Todas las consultas usan parámetros.
 */

interface TicketRow {
  id: string
  store: TicketStoreKind
  store_name: string
  address: string
  purchase_date: string
  purchase_time: string | null
  total_cents: number | null
  created_at: string
  lines_count?: number
  products_count?: number
  adjustments_json: string
  issues_json: string
}

interface LineRow {
  id: string
  ticket_id: string
  position: number
  raw_name: string
  name_key: string
  quantity: number
  unit_price_cents: number | null
  amount_cents: number | null
  discount_cents: number
  weight_kg: number | null
  price_per_kg_cents: number | null
  tax_code: TicketTaxCode | null
  item_id: string | null
  occasional: number
  review_status: 'verified' | 'pending'
  confirmed: number
  evidence_json: string | null
}

const TICKET_COLUMNS = 'id, store, store_name, address, purchase_date, purchase_time, total_cents, created_at, adjustments_json, issues_json'
const LINE_COLUMNS =
  'id, ticket_id, position, raw_name, name_key, quantity, unit_price_cents, amount_cents, discount_cents, weight_kg, price_per_kg_cents, tax_code, item_id, occasional, review_status, confirmed, evidence_json'

const toSummary = (r: TicketRow): PantryTicketSummary => ({
  id: r.id,
  store: r.store,
  storeName: r.store_name,
  address: r.address,
  date: r.purchase_date,
  time: r.purchase_time,
  totalCents: r.total_cents,
  linesCount: r.lines_count ?? 0,
  productsCount: r.products_count ?? 0,
  createdAt: r.created_at,
})

const toLine = (r: LineRow): PantryTicketLine => ({
  id: r.id,
  position: r.position,
  rawName: r.raw_name,
  quantity: r.quantity,
  unitPriceCents: r.unit_price_cents,
  amountCents: r.amount_cents,
  discountCents: r.discount_cents,
  weightKg: r.weight_kg,
  pricePerKgCents: r.price_per_kg_cents,
  taxCode: r.tax_code,
  itemId: r.item_id,
  occasional: r.occasional === 1,
  reviewStatus: r.review_status,
  confirmed: r.confirmed === 1,
  evidence: r.evidence_json ? JSON.parse(r.evidence_json) : undefined,
})

type PurchaseRow = LineRow & { purchase_date: string; store_name: string; created_at: string }

/** Sentencias preparadas una sola vez por conexión. */
function prepareStatements(db: Database.Database) {
  // Resumen de un ticket: cuántas líneas tiene y cuántos productos distintos de la despensa (solo líneas verificadas).
  const summary = `SELECT ${TICKET_COLUMNS.split(', ').map((c) => `t.${c}`).join(', ')},
      COUNT(l.id) AS lines_count, COUNT(DISTINCT CASE WHEN l.review_status = 'verified' AND l.amount_cents >= 0 THEN l.item_id END) AS products_count
    FROM pantry_tickets t LEFT JOIN pantry_ticket_lines l ON l.ticket_id = t.id`
  return {
    aliases: db.prepare<[string], { name_key: string; item_id: string | null }>('SELECT name_key, item_id FROM pantry_aliases WHERE store = ?'),
    upsertAlias: db.prepare<[string, string, string | null, number, string]>(
      `INSERT INTO pantry_aliases (store, name_key, item_id, ignored, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (store, name_key) DO UPDATE SET item_id = excluded.item_id, ignored = excluded.ignored, updated_at = excluded.updated_at`,
    ),
    byFingerprint: db.prepare<[string], TicketRow>(`${summary} WHERE t.fingerprint = ? GROUP BY t.id`),
    byImport: db.prepare<[string, string], TicketRow>(`${summary} WHERE t.import_id = ? OR t.source_fingerprint = ? GROUP BY t.id`),
    candidates: db.prepare<[string, number | null], TicketRow>(`${summary} WHERE t.purchase_date = ? AND t.total_cents IS ? GROUP BY t.id`),
    summaries: db.prepare<[number], TicketRow>(
      `${summary} GROUP BY t.id ORDER BY t.purchase_date DESC, t.purchase_time DESC, t.created_at DESC LIMIT ?`,
    ),
    summary: db.prepare<[string], TicketRow>(`${summary} WHERE t.id = ? GROUP BY t.id`),
    lines: db.prepare<[string], LineRow>(`SELECT ${LINE_COLUMNS} FROM pantry_ticket_lines WHERE ticket_id = ? ORDER BY position`),
    line: db.prepare<[string, string], LineRow>(`SELECT ${LINE_COLUMNS} FROM pantry_ticket_lines WHERE ticket_id = ? AND id = ?`),
    insertTicket: db.prepare(
      `INSERT INTO pantry_tickets (id, store, store_name, address, purchase_date, purchase_time, total_cents, fingerprint, created_at,
                                   adjustments_json, issues_json, import_id, source_fingerprint)
       VALUES (@id, @store, @store_name, @address, @purchase_date, @purchase_time, @total_cents, @fingerprint, @created_at,
               @adjustments_json, @issues_json, @import_id, @source_fingerprint)`,
    ),
    insertLine: db.prepare(
      `INSERT INTO pantry_ticket_lines (${LINE_COLUMNS})
       VALUES (@id, @ticket_id, @position, @raw_name, @name_key, @quantity, @unit_price_cents, @amount_cents, @discount_cents,
               @weight_kg, @price_per_kg_cents, @tax_code, @item_id, @occasional, @review_status, @confirmed, @evidence_json)`,
    ),
    setLineItem: db.prepare<[string | null, string]>('UPDATE pantry_ticket_lines SET item_id = ? WHERE id = ?'),
    deleteTicket: db.prepare<[string]>('DELETE FROM pantry_tickets WHERE id = ?'),
    purchases: db.prepare<[string], PurchaseRow>(
      `SELECT ${LINE_COLUMNS.split(', ').map((c) => `l.${c}`).join(', ')}, t.purchase_date, t.store_name, t.created_at
       FROM pantry_ticket_lines l JOIN pantry_tickets t ON t.id = l.ticket_id
       WHERE l.item_id IS NOT NULL AND l.occasional = 0 AND l.review_status = 'verified' AND t.purchase_date >= ?
       ORDER BY t.purchase_date, l.position`,
    ),
  }
}

export class SqliteTicketRepository implements TicketRepository {
  private readonly db: Database.Database
  private readonly sql: ReturnType<typeof prepareStatements>

  constructor(db: Database.Database) {
    this.db = db
    this.sql = prepareStatements(db)
  }

  aliases(aliasStore: string): AliasRecord[] {
    return this.sql.aliases.all(aliasStore).map((row) => ({ key: row.name_key, itemId: row.item_id }))
  }

  upsertAlias(aliasStore: string, nameKey: string, itemId: string | null, now: string): void {
    // `ignored` = 1 cuando el nombre se ha marcado como «no seguir» (sin producto).
    this.sql.upsertAlias.run(aliasStore, nameKey, itemId, itemId === null ? 1 : 0, now)
  }

  findByImport(importId: string, sourceFingerprint: string): PantryTicketSummary | null {
    const row = this.sql.byImport.get(importId, sourceFingerprint)
    return row ? toSummary(row) : null
  }

  findByFingerprint(fingerprint: string): PantryTicketSummary | null {
    const row = this.sql.byFingerprint.get(fingerprint)
    return row ? toSummary(row) : null
  }

  candidates(date: ISODate, totalCents: number | null): PantryTicketSummary[] {
    return this.sql.candidates.all(date, totalCents).map(toSummary)
  }

  listSummaries(limit: number): PantryTicketSummary[] {
    return this.sql.summaries.all(limit).map(toSummary)
  }

  getSummary(id: string): PantryTicketSummary | null {
    const row = this.sql.summary.get(id)
    return row ? toSummary(row) : null
  }

  getTicket(id: string): PantryTicket | null {
    const row = this.sql.summary.get(id)
    if (!row) return null
    return {
      ...toSummary(row),
      lines: this.sql.lines.all(id).map(toLine),
      adjustments: JSON.parse(row.adjustments_json),
      issues: JSON.parse(row.issues_json),
    }
  }

  getLine(ticketId: string, lineId: string): StoredLineRef | null {
    const row = this.sql.line.get(ticketId, lineId)
    return row ? { id: row.id, nameKey: row.name_key } : null
  }

  linesOf(ticketId: string): StoredLineRef[] {
    return this.sql.lines.all(ticketId).map((row) => ({ id: row.id, nameKey: row.name_key }))
  }

  insertTicket(ticket: TicketToInsert): void {
    this.sql.insertTicket.run({
      id: ticket.id,
      store: ticket.store,
      store_name: ticket.storeName,
      address: ticket.address,
      purchase_date: ticket.date,
      purchase_time: ticket.time,
      total_cents: ticket.totalCents,
      fingerprint: ticket.fingerprint,
      created_at: ticket.createdAt,
      adjustments_json: JSON.stringify(ticket.adjustments),
      issues_json: JSON.stringify(ticket.issues),
      import_id: ticket.importId,
      source_fingerprint: ticket.sourceFingerprint,
    })
  }

  insertLine(line: LineToInsert): void {
    this.sql.insertLine.run({
      id: line.id,
      ticket_id: line.ticketId,
      position: line.position,
      raw_name: line.rawName,
      name_key: line.nameKey,
      quantity: line.quantity,
      unit_price_cents: line.unitPriceCents,
      amount_cents: line.amountCents,
      discount_cents: line.discountCents,
      weight_kg: line.weightKg,
      price_per_kg_cents: line.pricePerKgCents,
      tax_code: line.taxCode,
      item_id: line.itemId,
      occasional: line.occasional ? 1 : 0,
      review_status: line.reviewStatus,
      confirmed: line.confirmed ? 1 : 0,
      evidence_json: line.evidence ? JSON.stringify(line.evidence) : null,
    })
  }

  setLineItem(lineId: string, itemId: string | null): void {
    this.sql.setLineItem.run(itemId, lineId)
  }

  deleteTicket(id: string): void {
    this.sql.deleteTicket.run(id)
  }

  purchaseLinesSince(date: ISODate): PurchaseLine[] {
    return this.sql.purchases.all(date).map((row) => ({
      ticketId: row.ticket_id,
      itemId: row.item_id as string,
      quantity: row.quantity,
      amountCents: row.amount_cents,
      discountCents: row.discount_cents,
      weightKg: row.weight_kg,
      date: row.purchase_date,
      store: row.store_name,
      recordedAt: row.created_at,
    }))
  }

  /** Vacía los tickets (sus líneas se van en cascada) y lo aprendido (solo para las pruebas). */
  reset(): void {
    this.db.exec('DELETE FROM pantry_tickets; DELETE FROM pantry_aliases;')
  }
}
