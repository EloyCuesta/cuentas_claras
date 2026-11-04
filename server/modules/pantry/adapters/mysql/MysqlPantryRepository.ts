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
import type { MysqlDatabase, SqlParam } from '../../../../common/mysql/MysqlDatabase.ts'
import type { PantryRepository } from '../../application/ports.ts'

/**
 * Despensa en MySQL (tablas pantry_people, pantry_items, pantry_events y
 * pantry_settings). Va aparte de las finanzas: restaurar una copia, importar
 * los datos del navegador o generar vencimientos no la tocan, y sus datos no
 * aparecen en /api/data.
 *
 * Solo SQL y conversión de filas: las comprobaciones, los mensajes, las
 * transacciones y cuándo se bloquea están en los casos de uso (application/).
 * Todas las consultas usan parámetros, también las listas IN (...).
 *
 * quantity y target son DECIMAL(10,3) y llegan como números (decimalNumbers);
 * las fechas, como texto AAAA-MM-DD (dateStrings).
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

const EVENT_COLUMNS = 'id, item_id, kind, event_date, created_at'

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

/** Los campos que se escriben de un producto, en el orden de ITEM_COLUMNS (de name a notes) y de UPDATE_ITEM. */
const inputValues = (input: PantryItemInput): SqlParam[] => [
  input.name,
  input.ownerId,
  input.unit,
  input.tracking,
  input.quantity,
  input.target,
  input.frequency,
  input.priceCents,
  input.notes,
]

const INSERT_ITEM = `INSERT INTO pantry_items (${ITEM_COLUMNS})
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
const UPDATE_ITEM = `UPDATE pantry_items
  SET name = ?, owner_id = ?, unit = ?, tracking = ?, quantity = ?, target = ?, frequency = ?, price_cents = ?, notes = ?,
      version = version + 1, updated_at = ?
  WHERE id = ?`

/** "?, ?, ?" con tantos parámetros como valores (para IN (...)). */
const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ')

export class MysqlPantryRepository implements PantryRepository {
  private readonly db: MysqlDatabase

  constructor(db: MysqlDatabase) {
    this.db = db
  }

  /* Personas -------------------------------------------------------------- */

  async listPeople(): Promise<PantryPerson[]> {
    return (await this.db.rows<PersonRow>('SELECT id, name, created_at FROM pantry_people')).map(toPerson)
  }

  async getPerson(id: string): Promise<PantryPerson | null> {
    const [row] = await this.db.rows<PersonRow>('SELECT id, name, created_at FROM pantry_people WHERE id = ?', [id])
    return row ? toPerson(row) : null
  }

  async insertPerson(person: PantryPerson): Promise<void> {
    await this.db.run('INSERT INTO pantry_people (id, name, created_at) VALUES (?, ?, ?)', [person.id, person.name, person.createdAt])
  }

  async renamePerson(id: string, name: string): Promise<void> {
    await this.db.run('UPDATE pantry_people SET name = ? WHERE id = ?', [name, id])
  }

  async deletePerson(id: string): Promise<void> {
    await this.db.run('DELETE FROM pantry_people WHERE id = ?', [id])
  }

  async countItemsOf(personId: string): Promise<number> {
    const [row] = await this.db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM pantry_items WHERE owner_id = ?', [personId])
    return row?.n ?? 0
  }

  /* Productos ------------------------------------------------------------- */

  async lockItems(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    // InnoDB bloquea las filas según recorre la clave primaria: en orden de id, también con IN (...).
    await this.db.rows(`SELECT id FROM pantry_items WHERE id IN (${placeholders(ids.length)}) ORDER BY id FOR UPDATE`, ids)
  }

  async listItems(): Promise<PantryItem[]> {
    return (await this.db.rows<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM pantry_items`)).map(toItem)
  }

  async getItem(id: string): Promise<PantryItem | null> {
    const [row] = await this.db.rows<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM pantry_items WHERE id = ?`, [id])
    return row ? toItem(row) : null
  }

  async getItems(ids: readonly string[]): Promise<PantryItem[]> {
    if (ids.length === 0) return []
    const rows = await this.db.rows<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM pantry_items WHERE id IN (${placeholders(ids.length)}) ORDER BY id`, ids)
    return rows.map(toItem)
  }

  async insertItem(id: string, input: PantryItemInput, now: string): Promise<void> {
    await this.db.run(INSERT_ITEM, [id, ...inputValues(input), now, now])
  }

  async updateItem(id: string, input: PantryItemInput, now: string): Promise<void> {
    await this.db.run(UPDATE_ITEM, [...inputValues(input), now, id])
  }

  async setQuantity(id: string, quantity: number, now: string): Promise<void> {
    await this.db.run('UPDATE pantry_items SET quantity = ?, version = version + 1, updated_at = ? WHERE id = ?', [quantity, now, id])
  }

  async setPrice(id: string, priceCents: number, now: string): Promise<void> {
    await this.db.run('UPDATE pantry_items SET price_cents = ?, version = version + 1, updated_at = ? WHERE id = ?', [priceCents, now, id])
  }

  async fillToTarget(ids: readonly string[], now: string): Promise<void> {
    if (ids.length === 0) return
    await this.db.run(
      `UPDATE pantry_items SET quantity = target, version = version + 1, updated_at = ?
       WHERE quantity < target AND id IN (${placeholders(ids.length)})`,
      [now, ...ids],
    )
  }

  async deleteItem(id: string): Promise<void> {
    await this.db.run('DELETE FROM pantry_items WHERE id = ?', [id])
  }

  /* Revisiones: «Queda», «Queda poco», «Se acabó», «Lo he comprado» -------- */

  async insertEvent(event: PantryEvent): Promise<void> {
    await this.db.run(`INSERT INTO pantry_events (${EVENT_COLUMNS}) VALUES (?, ?, ?, ?, ?)`, [
      event.id,
      event.itemId,
      event.kind,
      event.date,
      event.createdAt,
    ])
  }

  async getEvent(id: string): Promise<PantryEvent | null> {
    const [row] = await this.db.rows<EventRow>(`SELECT ${EVENT_COLUMNS} FROM pantry_events WHERE id = ?`, [id])
    return row ? toEvent(row) : null
  }

  async deleteEvent(id: string): Promise<void> {
    await this.db.run('DELETE FROM pantry_events WHERE id = ?', [id])
  }

  async eventsSince(date: ISODate): Promise<PantryEvent[]> {
    // El id deshace los empates de un mismo instante, que SQLite dejaba en el orden en que se apuntaron.
    const rows = await this.db.rows<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM pantry_events WHERE event_date >= ? ORDER BY event_date, created_at, id`,
      [date],
    )
    return rows.map(toEvent)
  }

  /* Presupuesto y repaso de la semana ------------------------------------ */

  async getSettings(): Promise<PantrySettings> {
    const [row] = await this.db.rows<{ monthly_budget_cents: number | null; last_review_date: string | null }>(
      'SELECT monthly_budget_cents, last_review_date FROM pantry_settings WHERE id = 1',
    )
    return { monthlyBudgetCents: row?.monthly_budget_cents ?? null, lastReviewDate: row?.last_review_date ?? null }
  }

  async setBudget(monthlyBudgetCents: number | null): Promise<void> {
    // pantry_settings solo tiene la clave primaria (id = 1): ON DUPLICATE KEY UPDATE no puede pisar otra fila.
    await this.db.run(
      'INSERT INTO pantry_settings (id, monthly_budget_cents) VALUES (1, ?) AS new ON DUPLICATE KEY UPDATE monthly_budget_cents = new.monthly_budget_cents',
      [monthlyBudgetCents],
    )
  }

  async setReviewDate(date: ISODate): Promise<void> {
    await this.db.run(
      'INSERT INTO pantry_settings (id, last_review_date) VALUES (1, ?) AS new ON DUPLICATE KEY UPDATE last_review_date = new.last_review_date',
      [date],
    )
  }

  async reset(): Promise<void> {
    // Los tickets y lo aprendido los vacía antes el módulo tickets (app.ts), por las claves foráneas.
    await this.db.run('DELETE FROM pantry_events')
    await this.db.run('DELETE FROM pantry_items')
    await this.db.run('DELETE FROM pantry_people')
    await this.db.run('DELETE FROM pantry_settings')
  }
}
