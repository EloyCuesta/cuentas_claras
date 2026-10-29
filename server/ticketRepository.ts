import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { addDays, todayISO } from '#shared/common/dates.ts'
import { nowISO } from '#shared/common/ids.ts'
import { MAX_PANTRY_CENTS } from '#shared/pantry/pantry.ts'
import type { AliasRecord } from '#shared/tickets/ticketMatch.ts'
import { nameKey } from '#shared/tickets/ticketText.ts'
import { canApplyLine, roundRatio } from '#shared/tickets/ticketArithmetic.ts'
import type { ISODate } from '#shared/common/types.ts'
import type { PantryActivity, PantryItem, PantryPurchase, PantryUnit } from '#shared/pantry/types.ts'
import type {
  PantryTicket,
  PantryTicketLine,
  PantryTicketSummary,
  TicketSaveInput,
  TicketSaveLine,
  TicketStoreKind,
  TicketTaxCode,
} from '#shared/tickets/types.ts'
import { AppError } from './common/errors.ts'
import type { PantryApi } from './modules/pantry/index.ts'

/**
 * Tickets de la compra en SQLite: guardarlos (creando o actualizando los
 * productos de la despensa en la misma transacción), aprender equivalencias y
 * dar el historial de compras para el ritmo de cada producto.
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

/** Las equivalencias se aprenden por tienda: Lidl, o el nombre de cada otra tienda. */
export function aliasStoreOf(store: TicketStoreKind, storeName: string): string {
  return store === 'lidl' ? 'lidl' : `otra:${nameKey(storeName)}`
}

/** Tienda, fecha, hora y total: el mismo ticket no se guarda dos veces. */
type DuplicateInput = Pick<TicketSaveInput, 'store' | 'storeName' | 'date' | 'time' | 'totalCents' | 'lines' | 'adjustments' | 'importId' | 'sourceFingerprint'>
export function ticketFingerprint(input: DuplicateInput): string {
  const lines = input.lines.map(l => [nameKey(l.rawName), l.quantity, l.unitPriceCents, l.amountCents,
    l.discountCents, l.weightKg === null ? null : Math.round(l.weightKg * 1000), l.pricePerKgCents]).map(l => JSON.stringify(l)).sort()
  const adjustments = (input.adjustments ?? []).map(a => [a.kind, a.amountCents]).map(a => JSON.stringify(a)).sort()
  return createHash('sha256').update(JSON.stringify([aliasStoreOf(input.store, input.storeName), input.date, input.time, input.totalCents, lines, adjustments])).digest('hex')
}

const COUNT_UNITS: ReadonlySet<PantryUnit> = new Set(['ud', 'paquete', 'lata', 'botella', 'bolsa', 'docena'])
const paid = (line: Pick<TicketSaveLine, 'amountCents' | 'discountCents'>) => (line.amountCents ?? 0) - line.discountCents

/** Precio por unidad (o por kilo) que deja un ticket para un producto, si la unidad lo permite. */
function priceFromLines(lines: readonly TicketSaveLine[], unit: PantryUnit): number | null {
  const usable = lines.filter(canApplyLine)
  const last = usable[usable.length - 1]
  if (!last) return null
  let price: number | null = null
  if (last.weightKg !== null && (unit === 'kg' || unit === 'g')) {
    price = roundRatio(paid(last) * 1000, Math.round(last.weightKg * 1000))
  } else if (last.weightKg === null && COUNT_UNITS.has(unit)) {
    price = roundRatio(paid(last), last.quantity)
  }
  return price !== null && price >= 0 && price <= MAX_PANTRY_CENTS ? price : null
}

/** Cuánto se compró en la unidad del producto (para los que se cuentan). */
function quantityFromLines(lines: readonly TicketSaveLine[], unit: PantryUnit): number | null {
  const bought = lines.filter(canApplyLine)
  if (bought.length === 0) return null
  if (bought.every((line) => line.weightKg !== null)) {
    const grams = bought.reduce((sum, line) => sum + Math.round((line.weightKg as number) * 1000), 0)
    if (unit === 'kg') return grams / 1000
    if (unit === 'g') return grams
    return null
  }
  if (bought.every((line) => line.weightKg === null) && COUNT_UNITS.has(unit)) return bought.reduce((sum, line) => sum + line.quantity, 0)
  return null
}

export class SqliteTicketRepository {
  private readonly db: Database.Database
  private readonly pantry: PantryApi
  private readonly now: () => string
  private readonly newId: () => string
  private readonly sql

  constructor(db: Database.Database, pantry: PantryApi, options: { now?: () => string; newId?: () => string } = {}) {
    this.db = db
    this.pantry = pantry
    this.now = options.now ?? nowISO
    this.newId = options.newId ?? randomUUID
    const summary = `SELECT ${TICKET_COLUMNS.split(', ').map((c) => `t.${c}`).join(', ')},
        COUNT(l.id) AS lines_count, COUNT(DISTINCT CASE WHEN l.review_status = 'verified' AND l.amount_cents >= 0 THEN l.item_id END) AS products_count
      FROM pantry_tickets t LEFT JOIN pantry_ticket_lines l ON l.ticket_id = t.id`
    this.sql = {
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
        `INSERT INTO pantry_tickets (id, store, store_name, address, purchase_date, purchase_time, total_cents, fingerprint, created_at, adjustments_json, issues_json, import_id, source_fingerprint)
         VALUES (@id, @store, @store_name, @address, @purchase_date, @purchase_time, @total_cents, @fingerprint, @created_at, @adjustments_json, @issues_json, @import_id, @source_fingerprint)`,
      ),
      insertLine: db.prepare(
        `INSERT INTO pantry_ticket_lines (${LINE_COLUMNS})
         VALUES (@id, @ticket_id, @position, @raw_name, @name_key, @quantity, @unit_price_cents, @amount_cents, @discount_cents,
                 @weight_kg, @price_per_kg_cents, @tax_code, @item_id, @occasional, @review_status, @confirmed, @evidence_json)`,
      ),
      setLineItem: db.prepare<[string | null, string]>('UPDATE pantry_ticket_lines SET item_id = ? WHERE id = ?'),
      deleteTicket: db.prepare<[string]>('DELETE FROM pantry_tickets WHERE id = ?'),
      purchases: db.prepare<
        [string],
        LineRow & { purchase_date: string; store_name: string; created_at: string }
      >(
        `SELECT ${LINE_COLUMNS.split(', ').map((c) => `l.${c}`).join(', ')}, t.purchase_date, t.store_name, t.created_at
         FROM pantry_ticket_lines l JOIN pantry_tickets t ON t.id = l.ticket_id
         WHERE l.item_id IS NOT NULL AND l.occasional = 0 AND l.review_status = 'verified' AND t.purchase_date >= ?
         ORDER BY t.purchase_date, l.position`,
      ),
    }
  }

  private transaction<T>(work: () => T): T {
    return this.db.transaction(work).immediate()
  }

  aliases(store: TicketStoreKind, storeName: string): AliasRecord[] {
    return this.sql.aliases.all(aliasStoreOf(store, storeName)).map((row) => ({ key: row.name_key, itemId: row.item_id }))
  }

  findDuplicate(input: DuplicateInput): PantryTicketSummary | null {
    const fingerprint = ticketFingerprint(input)
    const row = this.sql.byImport.get(input.importId ?? '', input.sourceFingerprint ?? '') ?? this.sql.byFingerprint.get(fingerprint)
    if (row) return toSummary(row)
    // Legacy rows have their original fingerprint; compare their contents.
    for (const candidate of this.sql.candidates.all(input.date, input.totalCents)) {
      const saved = this.getTicket(candidate.id)
      if (ticketFingerprint({ ...saved, store: candidate.store }) === fingerprint) return saved
    }
    return null
  }

  possibleDuplicate(input: DuplicateInput): PantryTicketSummary | null {
    const row = this.sql.candidates.all(input.date, input.totalCents).find(r => aliasStoreOf(r.store, r.store_name) === aliasStoreOf(input.store, input.storeName) &&
      (r.purchase_time === input.time || r.purchase_time === null || input.time === null))
    return row ? toSummary(row) : null
  }

  listTickets(limit = 100): PantryTicketSummary[] {
    return this.sql.summaries.all(limit).map(toSummary)
  }

  getTicket(id: string): PantryTicket {
    const row = this.sql.summary.get(id)
    if (!row) throw new AppError('NOT_FOUND', 'Ese ticket ya no existe.')
    return { ...toSummary(row), lines: this.sql.lines.all(id).map(toLine), adjustments: JSON.parse(row.adjustments_json), issues: JSON.parse(row.issues_json) }
  }

  /**
   * Guarda un ticket revisado, todo o nada: crea los productos nuevos, recuerda
   * las equivalencias, actualiza precios (y cantidades de los que se cuentan) y
   * guarda las líneas. 409 si el ticket ya estaba guardado.
   */
  saveTicket(input: TicketSaveInput): { ticket: PantryTicket; items: PantryItem[] } {
    return this.transaction(() => {
      const duplicate = this.findDuplicate(input)
      if (duplicate) {
        throw new AppError('CONFLICT', `Este ticket ya está guardado (${duplicate.storeName}, ${duplicate.date.split('-').reverse().join('/')}).`)
      }
      if (!input.distinctPurchase && this.possibleDuplicate(input)) throw new AppError('CONFLICT', 'Hay una compra con la misma fecha, hora y total. Confirma si se trata de otra compra.')
      const aliasStore = aliasStoreOf(input.store, input.storeName)
      const now = this.now()
      const linesByKey = new Map<string, TicketSaveLine[]>()
      for (const line of input.lines) {
        const key = nameKey(line.rawName)
        linesByKey.set(key, [...(linesByKey.get(key) ?? []), line])
      }

      // Productos de cada clave: existentes, nuevos (uno por nombre y persona) o ninguno.
      const itemOfKey = new Map<string, string | null>()
      const created = new Map<string, string>()
      for (const [key, lines] of linesByKey) {
        const decision = input.decisions[key]
        if (!decision) throw new AppError('VALIDATION', `Falta qué hacer con «${lines[0].rawName}».`)
        if (decision.kind === 'ignore') {
          itemOfKey.set(key, null)
          continue
        }
        if (decision.kind === 'item') {
          if (!this.pantry.getItem(decision.itemId)) {
            throw new AppError('VALIDATION', `«${lines[0].rawName}» está asociado a un producto que ya no existe. Elige otro.`)
          }
          itemOfKey.set(key, decision.itemId)
          continue
        }
        if (!lines.some(canApplyLine)) { itemOfKey.set(key, null); continue }
        const sameNew = `${nameKey(decision.name)}|${decision.ownerId ?? ''}`
        let id = created.get(sameNew)
        if (!id) {
          const allLines = [...linesByKey.entries()]
            .filter(([k]) => {
              const d = input.decisions[k]
              return d?.kind === 'new' && `${nameKey(d.name)}|${d.ownerId ?? ''}` === sameNew
            })
            .flatMap(([, l]) => l).filter(canApplyLine)
          const unit: PantryUnit = allLines.every((line) => line.weightKg !== null) ? 'kg' : 'ud'
          id = this.pantry.createItem({
            name: decision.name,
            ownerId: decision.ownerId,
            unit,
            tracking: 'compras',
            quantity: 0,
            target: 0,
            frequency: decision.frequency,
            priceCents: priceFromLines(allLines, unit),
            notes: '',
          }).id
          created.set(sameNew, id)
        }
        itemOfKey.set(key, id)
      }

      // Lo aprendido y lo que cambia en los productos que ya existían.
      for (const [key, itemId] of itemOfKey) {
        if (linesByKey.get(key)?.some(canApplyLine)) this.sql.upsertAlias.run(aliasStore, key, itemId, itemId === null ? 1 : 0, now)
      }
      const touched = new Map<string, TicketSaveLine[]>()
      for (const [key, itemId] of itemOfKey) {
        if (itemId === null || [...created.values()].includes(itemId)) continue
        touched.set(itemId, [...(touched.get(itemId) ?? []), ...(linesByKey.get(key) ?? []).filter(canApplyLine)])
      }
      for (const [itemId, lines] of touched) {
        if (!lines.length) continue
        // «Para una ocasión» no cuenta para el ritmo, pero lo comprado sí está en casa.
        const item = this.pantry.getItem(itemId) as PantryItem
        this.pantry.applyTicketPurchase(itemId, {
          priceCents: priceFromLines(lines, item.unit),
          addQuantity: quantityFromLines(lines, item.unit),
        })
      }

      const ticketId = this.newId()
      this.sql.insertTicket.run({
        id: ticketId,
        store: input.store,
        store_name: input.storeName,
        address: input.address,
        purchase_date: input.date,
        purchase_time: input.time,
        total_cents: input.totalCents,
        fingerprint: ticketFingerprint(input),
        created_at: now,
        adjustments_json: JSON.stringify(input.adjustments ?? []),
        issues_json: JSON.stringify(input.issues ?? []),
        import_id: input.importId ?? null,
        source_fingerprint: input.sourceFingerprint ?? null,
      })
      input.lines.forEach((line, position) => {
        this.sql.insertLine.run({
          id: this.newId(),
          ticket_id: ticketId,
          position,
          raw_name: line.rawName,
          name_key: nameKey(line.rawName),
          quantity: line.quantity,
          unit_price_cents: line.unitPriceCents,
          amount_cents: line.amountCents,
          discount_cents: line.discountCents,
          weight_kg: line.weightKg,
          price_per_kg_cents: line.pricePerKgCents,
          tax_code: line.taxCode,
          item_id: itemOfKey.get(nameKey(line.rawName)) ?? null,
          occasional: line.occasional ? 1 : 0,
          review_status: canApplyLine(line) || (line.amountCents !== null && line.amountCents < 0 && line.reviewStatus !== 'pending') ? 'verified' : 'pending',
          confirmed: line.confirmed ? 1 : 0,
          evidence_json: line.evidence ? JSON.stringify(line.evidence) : null,
        })
      })
      return { ticket: this.getTicket(ticketId), items: this.pantry.listItems() }
    })
  }

  /** Cambia el producto de una línea ya guardada (y lo recuerda para la próxima vez). */
  setLineItem(ticketId: string, lineId: string, itemId: string | null): PantryTicket {
    return this.transaction(() => {
      const ticket = this.sql.summary.get(ticketId)
      if (!ticket) throw new AppError('NOT_FOUND', 'Ese ticket ya no existe.')
      const line = this.sql.line.get(ticketId, lineId)
      if (!line) throw new AppError('NOT_FOUND', 'Esa línea del ticket ya no existe.')
      if (itemId !== null && !this.pantry.getItem(itemId)) throw new AppError('VALIDATION', 'Ese producto ya no existe. Elige otro.')
      // Todas las líneas iguales del ticket cambian a la vez.
      for (const other of this.sql.lines.all(ticketId)) if (other.name_key === line.name_key) this.sql.setLineItem.run(itemId, other.id)
      this.sql.upsertAlias.run(aliasStoreOf(ticket.store, ticket.store_name), line.name_key, itemId, itemId === null ? 1 : 0, this.now())
      return this.getTicket(ticketId)
    })
  }

  /** Borra un ticket y sus líneas. Los productos creados con él y lo aprendido se conservan. */
  deleteTicket(id: string): void {
    this.transaction(() => {
      if (!this.sql.summary.get(id)) throw new AppError('NOT_FOUND', 'Ese ticket ya no existe.')
      this.sql.deleteTicket.run(id)
    })
  }

  /**
   * Historial para el ritmo de compra: una compra por producto y ticket (sin
   * las líneas «para una ocasión» ni las devoluciones) y las revisiones.
   */
  activity(days = 400, today: ISODate = todayISO()): PantryActivity {
    const since = addDays(today, -days)
    const grouped = new Map<string, (LineRow & { purchase_date: string; store_name: string; created_at: string })[]>()
    for (const row of this.sql.purchases.all(since)) {
      if (row.amount_cents !== null && row.amount_cents < 0) continue
      const key = `${row.ticket_id}|${row.item_id}`
      grouped.set(key, [...(grouped.get(key) ?? []), row])
    }
    const purchases: PantryPurchase[] = [...grouped.values()].map((rows) => {
      const first = rows[0]
      const weighted = rows.every((row) => row.weight_kg !== null)
      const counted = rows.every((row) => row.weight_kg === null)
      const amount = weighted
        ? Math.round(rows.reduce((sum, row) => sum + (row.weight_kg as number), 0) * 1000) / 1000
        : counted
          ? rows.reduce((sum, row) => sum + row.quantity, 0)
          : null
      const costCents = rows.some((row) => row.amount_cents === null)
        ? null
        : rows.reduce((sum, row) => sum + (row.amount_cents as number) - row.discount_cents, 0)
      return {
        itemId: first.item_id as string,
        date: first.purchase_date,
        amount,
        measure: weighted ? 'kg' : counted ? 'ud' : null,
        costCents,
        store: first.store_name,
        ticketId: first.ticket_id,
        recordedAt: first.created_at,
      }
    })
    return { purchases, events: this.pantry.eventsSince(since) }
  }
}
