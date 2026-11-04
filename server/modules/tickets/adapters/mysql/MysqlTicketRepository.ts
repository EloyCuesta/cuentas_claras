import type { ISODate } from '#shared/common/types.ts'
import type { AliasRecord } from '#shared/tickets/ticketMatch.ts'
import type { PantryTicket, PantryTicketLine, PantryTicketSummary, TicketStoreKind, TicketTaxCode } from '#shared/tickets/types.ts'
import type { MysqlDatabase, SqlParam } from '../../../../common/mysql/MysqlDatabase.ts'
import type { LineToInsert, StoredLineRef, TicketRepository, TicketToInsert } from '../../application/ports.ts'
import type { PurchaseLine } from '../../domain/purchaseHistory.ts'

/**
 * Tickets de la compra en MySQL (tablas pantry_tickets, pantry_ticket_lines y
 * pantry_aliases). Sin imágenes: solo los datos que la persona confirmó.
 *
 * Solo SQL y conversión de filas: qué es un duplicado, qué hace cada línea,
 * las transacciones y el bloqueo «tickets» están en los casos de uso
 * (application/). Todas las consultas usan parámetros.
 *
 * - Ajustes, avisos y evidencia van en MEDIUMTEXT con el JSON tal cual
 *   (JSON.stringify al guardar y JSON.parse al leer, como en SQLite).
 * - weight_kg es DECIMAL(7,3) y llega como número; purchase_date, como texto
 *   AAAA-MM-DD; los booleanos, como 0/1.
 * - Las consultas que devuelven varias filas, o la primera de varias, llevan
 *   un ORDER BY completo: SQLite las daba en el orden de su GROUP BY (por id)
 *   y MySQL no garantiza ninguno.
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

/**
 * Resumen de un ticket: cuántas líneas tiene y cuántos productos distintos de
 * la despensa (solo líneas verificadas). Agrupar por la clave primaria deja
 * elegir el resto de columnas de t aunque el modo sea ONLY_FULL_GROUP_BY.
 */
const SUMMARY = `SELECT ${TICKET_COLUMNS.split(', ').map((c) => `t.${c}`).join(', ')},
    COUNT(l.id) AS lines_count,
    COUNT(DISTINCT CASE WHEN l.review_status = 'verified' AND l.amount_cents >= 0 THEN l.item_id END) AS products_count
  FROM pantry_tickets t LEFT JOIN pantry_ticket_lines l ON l.ticket_id = t.id`

const INSERT_TICKET = `INSERT INTO pantry_tickets (id, store, store_name, address, purchase_date, purchase_time, total_cents, fingerprint,
    created_at, adjustments_json, issues_json, import_id, source_fingerprint)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
const INSERT_LINE = `INSERT INTO pantry_ticket_lines (${LINE_COLUMNS}) VALUES (${LINE_COLUMNS.split(', ').map(() => '?').join(', ')})`
// La clave de pantry_aliases es (store, name_key) y no tiene otra única: ON DUPLICATE KEY UPDATE no puede pisar otra fila.
const UPSERT_ALIAS = `INSERT INTO pantry_aliases (store, name_key, item_id, ignored, updated_at) VALUES (?, ?, ?, ?, ?) AS new
  ON DUPLICATE KEY UPDATE item_id = new.item_id, ignored = new.ignored, updated_at = new.updated_at`

export class MysqlTicketRepository implements TicketRepository {
  private readonly db: MysqlDatabase

  constructor(db: MysqlDatabase) {
    this.db = db
  }

  private async summary(where: string, params: SqlParam[]): Promise<PantryTicketSummary | null> {
    const [row] = await this.db.rows<TicketRow>(`${SUMMARY} WHERE ${where} GROUP BY t.id ORDER BY t.id LIMIT 1`, params)
    return row ? toSummary(row) : null
  }

  async aliases(aliasStore: string): Promise<AliasRecord[]> {
    const rows = await this.db.rows<{ name_key: string; item_id: string | null }>(
      'SELECT name_key, item_id FROM pantry_aliases WHERE store = ? ORDER BY name_key',
      [aliasStore],
    )
    return rows.map((row) => ({ key: row.name_key, itemId: row.item_id }))
  }

  async upsertAlias(aliasStore: string, nameKey: string, itemId: string | null, now: string): Promise<void> {
    // `ignored` = 1 cuando el nombre se ha marcado como «no seguir» (sin producto).
    await this.db.run(UPSERT_ALIAS, [aliasStore, nameKey, itemId, itemId === null ? 1 : 0, now])
  }

  findByImport(importId: string, sourceFingerprint: string): Promise<PantryTicketSummary | null> {
    return this.summary('t.import_id = ? OR t.source_fingerprint = ?', [importId, sourceFingerprint])
  }

  findByFingerprint(fingerprint: string): Promise<PantryTicketSummary | null> {
    return this.summary('t.fingerprint = ?', [fingerprint])
  }

  async candidates(date: ISODate, totalCents: number | null): Promise<PantryTicketSummary[]> {
    // <=> compara también NULL con NULL, como «IS ?» en SQLite.
    const rows = await this.db.rows<TicketRow>(`${SUMMARY} WHERE t.purchase_date = ? AND t.total_cents <=> ? GROUP BY t.id ORDER BY t.id`, [
      date,
      totalCents,
    ])
    return rows.map(toSummary)
  }

  async listSummaries(limit: number): Promise<PantryTicketSummary[]> {
    const rows = await this.db.rows<TicketRow>(
      `${SUMMARY} GROUP BY t.id ORDER BY t.purchase_date DESC, t.purchase_time DESC, t.created_at DESC, t.id LIMIT ?`,
      [limit],
    )
    return rows.map(toSummary)
  }

  getSummary(id: string): Promise<PantryTicketSummary | null> {
    return this.summary('t.id = ?', [id])
  }

  async getTicket(id: string): Promise<PantryTicket | null> {
    const [row] = await this.db.rows<TicketRow>(`${SUMMARY} WHERE t.id = ? GROUP BY t.id`, [id])
    if (!row) return null
    const lines = await this.db.rows<LineRow>(`SELECT ${LINE_COLUMNS} FROM pantry_ticket_lines WHERE ticket_id = ? ORDER BY position`, [id])
    return {
      ...toSummary(row),
      lines: lines.map(toLine),
      adjustments: JSON.parse(row.adjustments_json),
      issues: JSON.parse(row.issues_json),
    }
  }

  async getLine(ticketId: string, lineId: string): Promise<StoredLineRef | null> {
    const [row] = await this.db.rows<LineRow>(`SELECT ${LINE_COLUMNS} FROM pantry_ticket_lines WHERE ticket_id = ? AND id = ?`, [ticketId, lineId])
    return row ? { id: row.id, nameKey: row.name_key } : null
  }

  async linesOf(ticketId: string): Promise<StoredLineRef[]> {
    const rows = await this.db.rows<{ id: string; name_key: string }>(
      'SELECT id, name_key FROM pantry_ticket_lines WHERE ticket_id = ? ORDER BY position',
      [ticketId],
    )
    return rows.map((row) => ({ id: row.id, nameKey: row.name_key }))
  }

  async insertTicket(ticket: TicketToInsert): Promise<void> {
    await this.db.run(INSERT_TICKET, [
      ticket.id,
      ticket.store,
      ticket.storeName,
      ticket.address,
      ticket.date,
      ticket.time,
      ticket.totalCents,
      ticket.fingerprint,
      ticket.createdAt,
      JSON.stringify(ticket.adjustments),
      JSON.stringify(ticket.issues),
      ticket.importId,
      ticket.sourceFingerprint,
    ])
  }

  async insertLine(line: LineToInsert): Promise<void> {
    await this.db.run(INSERT_LINE, [
      line.id,
      line.ticketId,
      line.position,
      line.rawName,
      line.nameKey,
      line.quantity,
      line.unitPriceCents,
      line.amountCents,
      line.discountCents,
      line.weightKg,
      line.pricePerKgCents,
      line.taxCode,
      line.itemId,
      line.occasional ? 1 : 0,
      line.reviewStatus,
      line.confirmed ? 1 : 0,
      line.evidence ? JSON.stringify(line.evidence) : null,
    ])
  }

  async setLineItem(lineId: string, itemId: string | null): Promise<void> {
    await this.db.run('UPDATE pantry_ticket_lines SET item_id = ? WHERE id = ?', [itemId, lineId])
  }

  async deleteTicket(id: string): Promise<void> {
    await this.db.run('DELETE FROM pantry_tickets WHERE id = ?', [id])
  }

  async purchaseLinesSince(date: ISODate): Promise<PurchaseLine[]> {
    const rows = await this.db.rows<PurchaseRow>(
      `SELECT ${LINE_COLUMNS.split(', ').map((c) => `l.${c}`).join(', ')}, t.purchase_date, t.store_name, t.created_at
       FROM pantry_ticket_lines l JOIN pantry_tickets t ON t.id = l.ticket_id
       WHERE l.item_id IS NOT NULL AND l.occasional = 0 AND l.review_status = 'verified' AND t.purchase_date >= ?
       ORDER BY t.purchase_date, l.position, t.created_at, t.id`,
      [date],
    )
    return rows.map((row) => ({
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
  async reset(): Promise<void> {
    await this.db.run('DELETE FROM pantry_tickets')
    await this.db.run('DELETE FROM pantry_aliases')
  }
}
