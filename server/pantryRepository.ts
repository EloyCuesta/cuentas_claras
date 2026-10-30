import { todayISO } from '../src/domain/dates.ts'
import { checkQuantity, sortItems, sortPeople, stepQuantity } from '../src/domain/pantry.ts'
import { isCounted } from '../src/domain/pantryTracking.ts'
import type {
  ISODate,
  PantryEvent,
  PantryEventKind,
  PantryFrequency,
  PantryItem,
  PantryItemInput,
  PantryPerson,
  PantryPurchaseChange,
  PantrySettings,
  PantryTracking,
  PantryUnit,
} from '../src/domain/types.ts'
import { AppError } from './errors.ts'
import { placeholders, type SqliteContext } from './infra/sqlite.ts'

/**
 * Despensa en SQLite. Va aparte de SqliteFinanceRepository: restaurar una copia
 * financiera, importar los datos del navegador o generar vencimientos no la
 * tocan, y sus datos no aparecen en /api/data.
 *
 * Los ids y las marcas de tiempo los pone el servidor (crypto.randomUUID de
 * Node), así funciona igual desde el móvil por HTTP en la red de casa.
 * Todas las consultas usan parámetros y cada operación es una transacción.
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

export interface PurchaseResult {
  /** Solo los productos que han cambiado (los que ya tenían su objetivo no se tocan). */
  changes: PantryPurchaseChange[]
  items: PantryItem[]
}

export class SqlitePantryRepository {
  private readonly ctx: SqliteContext
  private readonly sql

  constructor(ctx: SqliteContext) {
    this.ctx = ctx
    const db = ctx.db
    this.sql = {
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

  private get db() {
    return this.ctx.db
  }

  private now(): string {
    return this.ctx.now()
  }

  private newId(): string {
    return this.ctx.newId()
  }

  private transaction<T>(work: () => T): T {
    return this.ctx.transaction(work)
  }

  private requirePerson(id: string): PersonRow {
    const person = this.sql.person.get(id)
    if (!person) throw new AppError('NOT_FOUND', 'Esa persona ya no existe. Vuelve a cargar la despensa.')
    return person
  }

  private requireItem(id: string): ItemRow {
    const item = this.sql.item.get(id)
    if (!item) throw new AppError('NOT_FOUND', 'Ese producto ya no existe. Vuelve a cargar la despensa.')
    return item
  }

  private requireOwner(ownerId: string | null): void {
    if (ownerId !== null && !this.sql.person.get(ownerId)) {
      throw new AppError('VALIDATION', 'El producto es de una persona que no existe. Elige otra o «Compartido».')
    }
  }

  /* Personas -------------------------------------------------------------- */

  listPeople(): PantryPerson[] {
    return sortPeople(this.sql.people.all().map(toPerson))
  }

  createPerson(name: string): PantryPerson {
    return this.transaction(() => {
      const person = { id: this.newId(), name, createdAt: this.now() }
      this.sql.insertPerson.run(person.id, person.name, person.createdAt)
      return person
    })
  }

  renamePerson(id: string, name: string): PantryPerson {
    return this.transaction(() => {
      this.requirePerson(id)
      this.sql.renamePerson.run(name, id)
      return toPerson(this.requirePerson(id))
    })
  }

  deletePerson(id: string): void {
    this.transaction(() => {
      const person = this.requirePerson(id)
      const { n } = this.sql.itemsOfPerson.get(id) ?? { n: 0 }
      if (n > 0) {
        throw new AppError(
          'CONFLICT',
          `«${person.name}» tiene ${n === 1 ? 'un producto' : `${n} productos`}. Pásalos a otra persona o a «Compartido», o elimínalos, antes de borrarla.`,
        )
      }
      this.sql.deletePerson.run(id)
    })
  }

  /* Productos ------------------------------------------------------------- */

  listItems(): PantryItem[] {
    return sortItems(this.sql.items.all().map(toItem))
  }

  private itemParams(id: string, input: PantryItemInput) {
    return {
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
      now: this.now(),
    }
  }

  createItem(input: PantryItemInput): PantryItem {
    return this.transaction(() => {
      this.requireOwner(input.ownerId)
      const id = this.newId()
      this.sql.insertItem.run(this.itemParams(id, input))
      return toItem(this.requireItem(id))
    })
  }

  updateItem(id: string, input: PantryItemInput): PantryItem {
    return this.transaction(() => {
      this.requireItem(id)
      this.requireOwner(input.ownerId)
      this.sql.updateItem.run(this.itemParams(id, input))
      return toItem(this.requireItem(id))
    })
  }

  /** Suma o resta a la cantidad actual (botones + y −). Se calcula con el valor actual del servidor. */
  adjustItem(id: string, delta: number): PantryItem {
    return this.transaction(() => {
      const item = this.requireItem(id)
      const checked = checkQuantity(stepQuantity(item.quantity, delta), item.unit)
      if (!checked.ok) throw new AppError('VALIDATION', checked.error)
      this.sql.setQuantity.run(checked.value, this.now(), id)
      return toItem(this.requireItem(id))
    })
  }

  deleteItem(id: string): void {
    this.transaction(() => {
      this.requireItem(id)
      this.sql.deleteItem.run(id)
    })
  }

  getItem(id: string): PantryItem | null {
    const row = this.sql.item.get(id)
    return row ? toItem(row) : null
  }

  /** Lo que deja un ticket en un producto: nuevo precio y, si se cuenta, lo comprado. Sube la versión si cambia algo. */
  applyTicketPurchase(id: string, { priceCents, addQuantity }: { priceCents: number | null; addQuantity: number | null }): void {
    const row = this.requireItem(id)
    const now = this.now()
    if (priceCents !== null && priceCents !== row.price_cents) this.sql.setPrice.run(priceCents, now, id)
    if (addQuantity !== null && addQuantity > 0 && isCounted(row)) {
      const checked = checkQuantity(Math.round((row.quantity + addQuantity) * 1000) / 1000, row.unit)
      if (checked.ok) this.sql.setQuantity.run(checked.value, now, id)
    }
  }

  /* Revisiones: «Queda», «Se acabó», «Lo he comprado» ---------------------- */

  addEvent(itemId: string, kind: PantryEventKind, date: ISODate): PantryEvent {
    return this.transaction(() => {
      this.requireItem(itemId)
      const event = { id: this.newId(), itemId, kind, date, createdAt: this.now() }
      this.sql.insertEvent.run(event.id, itemId, kind, date, event.createdAt)
      return event
    })
  }

  deleteEvent(id: string): void {
    this.transaction(() => {
      if (!this.sql.event.get(id)) throw new AppError('NOT_FOUND', 'Esa revisión ya no existe.')
      this.sql.deleteEvent.run(id)
    })
  }

  /** Revisiones desde una fecha (el historial de compras está en los tickets). */
  eventsSince(date: ISODate): PantryEvent[] {
    return this.sql.events.all(date).map(toEvent)
  }

  /* Presupuesto y repaso de la semana ------------------------------------ */

  getSettings(): PantrySettings {
    const row = this.sql.settings.get()
    return { monthlyBudgetCents: row?.monthly_budget_cents ?? null, lastReviewDate: row?.last_review_date ?? null }
  }

  setBudget(monthlyBudgetCents: number | null): PantrySettings {
    return this.transaction(() => {
      this.sql.setBudget.run(monthlyBudgetCents)
      return this.getSettings()
    })
  }

  /** Apunta el día del repaso de la semana (la fecha de hoy del usuario). */
  setReviewDate(date: ISODate): PantrySettings {
    return this.transaction(() => {
      this.sql.setReviewDate.run(date)
      return this.getSettings()
    })
  }

  /* Comprado y deshacer --------------------------------------------------- */

  /**
   * Marca como comprados los productos indicados, con sus valores actuales en
   * el servidor. Si alguno no existe no se cambia nada.
   * - Los que se cuentan: quantity = target. Los que ya tienen su objetivo, o
   *   más, se dejan como están: comprar nunca reduce lo que hay.
   * - Los que se siguen por compras: se apunta «Lo he comprado» con la fecha
   *   indicada (la de hoy del usuario; si no llega, la del servidor).
   */
  markPurchased(ids: readonly string[], date: ISODate | null = null): PurchaseResult {
    return this.transaction(() => {
      const unique = [...new Set(ids)]
      const rows = this.db
        .prepare<string[], ItemRow>(`SELECT ${ITEM_COLUMNS} FROM pantry_items WHERE id IN (${placeholders(unique.length)})`)
        .all(...unique)
      if (rows.length !== unique.length) {
        throw new AppError('NOT_FOUND', 'Algún producto de la lista ya no existe. Vuelve a cargar la despensa; no se ha cambiado nada.')
      }
      const bought: PantryPurchaseChange[] = rows
        .filter((row) => !isCounted(row))
        .map((row) => ({ id: row.id, eventId: this.addEvent(row.id, 'comprado', date ?? todayISO()).id }))
      const pending = rows.filter((row) => isCounted(row) && row.quantity < row.target)
      if (pending.length > 0) {
        // Un solo UPDATE para todos los productos.
        this.db
          .prepare(
            `UPDATE pantry_items SET quantity = target, version = version + 1, updated_at = ?
             WHERE quantity < target AND id IN (${placeholders(pending.length)})`,
          )
          .run(this.now(), ...pending.map((row) => row.id))
      }
      const changes: PantryPurchaseChange[] = [
        ...pending.map((row) => ({ id: row.id, previousQuantity: row.quantity, version: this.requireItem(row.id).version })),
        ...bought,
      ]
      return { changes, items: this.listItems() }
    })
  }

  /**
   * Deshace una compra: devuelve cada producto a su cantidad anterior. Solo si
   * ninguno ha cambiado desde entonces (misma versión); si no, 409 y no se
   * toca nada. Solo se restaura la cantidad, nunca otros campos.
   */
  undoPurchase(changes: readonly PantryPurchaseChange[]): PantryItem[] {
    return this.transaction(() => {
      const conflict = () =>
        new AppError(
          'CONFLICT',
          'No se puede deshacer: algún producto ha cambiado o se ha borrado después de la compra (quizá desde otro dispositivo). No se ha tocado nada.',
        )
      const quantities: { id: string; quantity: number }[] = []
      const events: string[] = []
      for (const change of changes) {
        if ('eventId' in change) {
          const event = this.sql.event.get(change.eventId)
          if (!event || event.item_id !== change.id || event.kind !== 'comprado') throw conflict()
          events.push(change.eventId)
          continue
        }
        const row = this.sql.item.get(change.id)
        if (!row || row.version !== change.version) throw conflict()
        const quantity = checkQuantity(change.previousQuantity, row.unit)
        if (!quantity.ok) throw new AppError('VALIDATION', quantity.error)
        quantities.push({ id: change.id, quantity: quantity.value })
      }
      const now = this.now()
      for (const { id, quantity } of quantities) this.sql.setQuantity.run(quantity, now, id)
      for (const id of events) this.sql.deleteEvent.run(id)
      return this.listItems()
    })
  }

  /** Vacía la despensa (solo para las pruebas). */
  reset(): void {
    this.transaction(() => {
      this.db.exec(`
        DELETE FROM pantry_tickets; DELETE FROM pantry_aliases; DELETE FROM pantry_events;
        DELETE FROM pantry_items; DELETE FROM pantry_people; DELETE FROM pantry_settings;
      `)
    })
  }
}
