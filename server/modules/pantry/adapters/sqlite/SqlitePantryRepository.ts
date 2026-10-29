import type Database from 'better-sqlite3'
import type { ISODate } from '#shared/common/types.ts'
import type {
  PantryEvent,
  PantryEventKind,
  PantryFrequency,
  PantryItem,
  PantryItemInput,
  PantryPerson,
  PantrySettings,
  PantryTracking,
  PantryUnit,
} from '#shared/pantry/types.ts'
import type { PantryRepository } from '../../application/ports.ts'

/**
 * Despensa en SQLite (tablas pantry_people, pantry_items, pantry_events y
 * pantry_settings). Va aparte de las finanzas: restaurar una copia, importar
 * los datos del navegador o generar vencimientos no la tocan, y sus datos no
 * aparecen en /api/data.
 *
 * Solo SQL y conversión de filas: las comprobaciones, los mensajes y las
 * transacciones están en los casos de uso (application/). Todas las consultas
 * usan parámetros, también las listas IN (...).
 */

interface PersonRow {
  id: string
  name: string
  created_at: string
}

interface ItemRow {
  id: string
  name: string
  owner_id: string | null
  unit: PantryUnit
  tracking: PantryTracking
  quantity: number
  target: number
  frequency: PantryFrequency
  price_cents: number | null
  notes: string
  version: number
  created_at: string
  updated_at: string
}

const ITEM_COLUMNS = 'id, name, owner_id, unit, tracking, quantity, target, frequency, price_cents, notes, version, created_at, updated_at'

interface EventRow {
  id: string
  item_id: string
  kind: PantryEventKind
  event_date: string
  created_at: string
}

const toEvent = (r: EventRow): PantryEvent => ({ id: r.id, itemId: r.item_id, kind: r.kind, date: r.event_date, createdAt: r.created_at })

const toPerson = (r: PersonRow): PantryPerson => ({ id: r.id, name: r.name, createdAt: r.created_at })

const toItem = (r: ItemRow): PantryItem => ({
  id: r.id,
  name: r.name,
  ownerId: r.owner_id,
  unit: r.unit,
  tracking: r.tracking,
  quantity: r.quantity,
  target: r.target,
  frequency: r.frequency,
  priceCents: r.price_cents,
  notes: r.notes,
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const itemParams = (id: string, input: PantryItemInput, now: string) => ({
  id,
  name: input.name,
  owner_id: input.ownerId,
  unit: input.unit,
  tracking: input.tracking,
  quantity: input.quantity,
  target: input.target,
  frequency: input.frequency,
  price_cents: input.priceCents,
  notes: input.notes,
  now,
})

/** "?, ?, ?" con tantos parámetros como valores (para IN (...)). */
const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ')

/** Sentencias preparadas una sola vez por conexión. */
function prepareStatements(db: Database.Database) {
  return {
    people: db.prepare<[], PersonRow>('SELECT id, name, created_at FROM pantry_people'),
    person: db.prepare<[string], PersonRow>('SELECT id, name, created_at FROM pantry_people WHERE id = ?'),
    insertPerson: db.prepare<[string, string, string]>('INSERT INTO pantry_people (id, name, created_at) VALUES (?, ?, ?)'),
    renamePerson: db.prepare<[string, string]>('UPDATE pantry_people SET name = ? WHERE id = ?'),
    deletePerson: db.prepare<[string]>('DELETE FROM pantry_people WHERE id = ?'),
    itemsOfPerson: db.prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM pantry_items WHERE owner_id = ?'),
    items: db.prepare<[], ItemRow>(`SELECT ${ITEM_COLUMNS} FROM pantry_items`),
    item: db.prepare<[string], ItemRow>(`SELECT ${ITEM_COLUMNS} FROM pantry_items WHERE id = ?`),
    insertItem: db.prepare(
      `INSERT INTO pantry_items (${ITEM_COLUMNS})
       VALUES (@id, @name, @owner_id, @unit, @tracking, @quantity, @target, @frequency, @price_cents, @notes, 1, @now, @now)`,
    ),
    updateItem: db.prepare(
      `UPDATE pantry_items
       SET name = @name, owner_id = @owner_id, unit = @unit, tracking = @tracking, quantity = @quantity, target = @target,
           frequency = @frequency, price_cents = @price_cents, notes = @notes, version = version + 1, updated_at = @now
       WHERE id = @id`,
    ),
    setQuantity: db.prepare<[number, string, string]>(
      'UPDATE pantry_items SET quantity = ?, version = version + 1, updated_at = ? WHERE id = ?',
    ),
    setPrice: db.prepare<[number, string, string]>('UPDATE pantry_items SET price_cents = ?, version = version + 1, updated_at = ? WHERE id = ?'),
    events: db.prepare<[string], EventRow>('SELECT id, item_id, kind, event_date, created_at FROM pantry_events WHERE event_date >= ? ORDER BY event_date, created_at'),
    event: db.prepare<[string], EventRow>('SELECT id, item_id, kind, event_date, created_at FROM pantry_events WHERE id = ?'),
    insertEvent: db.prepare<[string, string, PantryEventKind, string, string]>(
      'INSERT INTO pantry_events (id, item_id, kind, event_date, created_at) VALUES (?, ?, ?, ?, ?)',
    ),
    deleteEvent: db.prepare<[string]>('DELETE FROM pantry_events WHERE id = ?'),
    deleteItem: db.prepare<[string]>('DELETE FROM pantry_items WHERE id = ?'),
    settings: db.prepare<[], { monthly_budget_cents: number | null; last_review_date: string | null }>(
      'SELECT monthly_budget_cents, last_review_date FROM pantry_settings WHERE id = 1',
    ),
    setBudget: db.prepare<[number | null]>(
      `INSERT INTO pantry_settings (id, monthly_budget_cents) VALUES (1, ?)
       ON CONFLICT (id) DO UPDATE SET monthly_budget_cents = excluded.monthly_budget_cents`,
    ),
    setReviewDate: db.prepare<[string]>(
      `INSERT INTO pantry_settings (id, last_review_date) VALUES (1, ?)
       ON CONFLICT (id) DO UPDATE SET last_review_date = excluded.last_review_date`,
    ),
  }
}

export class SqlitePantryRepository implements PantryRepository {
  private readonly db: Database.Database
  private readonly sql: ReturnType<typeof prepareStatements>

  constructor(db: Database.Database) {
    this.db = db
    this.sql = prepareStatements(db)
  }

  /* Personas -------------------------------------------------------------- */

  listPeople(): PantryPerson[] {
    return this.sql.people.all().map(toPerson)
  }

  getPerson(id: string): PantryPerson | null {
    const row = this.sql.person.get(id)
    return row ? toPerson(row) : null
  }

  insertPerson(person: PantryPerson): void {
    this.sql.insertPerson.run(person.id, person.name, person.createdAt)
  }

  renamePerson(id: string, name: string): void {
    this.sql.renamePerson.run(name, id)
  }

  deletePerson(id: string): void {
    this.sql.deletePerson.run(id)
  }

  countItemsOf(personId: string): number {
    return this.sql.itemsOfPerson.get(personId)?.n ?? 0
  }

  /* Productos ------------------------------------------------------------- */

  listItems(): PantryItem[] {
    return this.sql.items.all().map(toItem)
  }

  getItem(id: string): PantryItem | null {
    const row = this.sql.item.get(id)
    return row ? toItem(row) : null
  }

  getItems(ids: readonly string[]): PantryItem[] {
    return this.db
      .prepare<string[], ItemRow>(`SELECT ${ITEM_COLUMNS} FROM pantry_items WHERE id IN (${placeholders(ids.length)})`)
      .all(...ids)
      .map(toItem)
  }

  insertItem(id: string, input: PantryItemInput, now: string): void {
    this.sql.insertItem.run(itemParams(id, input, now))
  }

  updateItem(id: string, input: PantryItemInput, now: string): void {
    this.sql.updateItem.run(itemParams(id, input, now))
  }

  setQuantity(id: string, quantity: number, now: string): void {
    this.sql.setQuantity.run(quantity, now, id)
  }

  setPrice(id: string, priceCents: number, now: string): void {
    this.sql.setPrice.run(priceCents, now, id)
  }

  fillToTarget(ids: readonly string[], now: string): void {
    this.db
      .prepare(
        `UPDATE pantry_items SET quantity = target, version = version + 1, updated_at = ?
         WHERE quantity < target AND id IN (${placeholders(ids.length)})`,
      )
      .run(now, ...ids)
  }

  deleteItem(id: string): void {
    this.sql.deleteItem.run(id)
  }

  /* Revisiones: «Queda», «Queda poco», «Se acabó», «Lo he comprado» -------- */

  insertEvent(event: PantryEvent): void {
    this.sql.insertEvent.run(event.id, event.itemId, event.kind, event.date, event.createdAt)
  }

  getEvent(id: string): PantryEvent | null {
    const row = this.sql.event.get(id)
    return row ? toEvent(row) : null
  }

  deleteEvent(id: string): void {
    this.sql.deleteEvent.run(id)
  }

  eventsSince(date: ISODate): PantryEvent[] {
    return this.sql.events.all(date).map(toEvent)
  }

  /* Presupuesto y repaso de la semana ------------------------------------ */

  getSettings(): PantrySettings {
    const row = this.sql.settings.get()
    return { monthlyBudgetCents: row?.monthly_budget_cents ?? null, lastReviewDate: row?.last_review_date ?? null }
  }

  setBudget(monthlyBudgetCents: number | null): void {
    this.sql.setBudget.run(monthlyBudgetCents)
  }

  setReviewDate(date: ISODate): void {
    this.sql.setReviewDate.run(date)
  }

  reset(): void {
    // Los tickets y lo aprendido también, mientras el módulo tickets no tenga su propio reset.
    this.db.exec(`
      DELETE FROM pantry_tickets; DELETE FROM pantry_aliases; DELETE FROM pantry_events;
      DELETE FROM pantry_items; DELETE FROM pantry_people; DELETE FROM pantry_settings;
    `)
  }
}
