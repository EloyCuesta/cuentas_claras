import Database from 'better-sqlite3'
import type { ISODate } from '../../shared/core/types.ts'
import { DEFAULT_CATEGORIES, withDescendants } from '../../shared/finance/categories.ts'
import type { FinanceRepository, MetaKey, SaveRecurringOptions } from '../../shared/finance/FinanceRepository.ts'
import { planOccurrences } from '../../shared/finance/recurring.ts'
import type {
  Category,
  FinanceData,
  Frequency,
  Movement,
  MovementStatus,
  MovementType,
  RecurringRule,
} from '../../shared/finance/types.ts'
import { AppError } from '../infra/errors.ts'
import { placeholders, type SqliteContext } from '../infra/sqlite.ts'

/**
 * Implementación de FinanceRepository con SQLite (better-sqlite3).
 *
 * Cumple el contrato FinanceRepository (shared/finance). better-sqlite3 es síncrono: cada método se ejecuta entero dentro de
 * una transacción y el servidor atiende las peticiones de una en una, de modo
 * que dos pestañas que generan vencimientos a la vez nunca los duplican (y el
 * índice único de la base de datos lo garantiza de todas formas).
 *
 * Todas las consultas usan parámetros (?, @nombre): ningún dato del usuario
 * se concatena en el SQL.
 */

interface CategoryRow {
  id: string
  name: string
  type: MovementType
  parent_id: string | null
  order_index: number
  budget_cents: number | null
}

interface MovementRow {
  id: string
  concept: string
  amount_cents: number
  type: MovementType
  category_id: string
  status: MovementStatus
  paid_date: string | null
  due_date: string | null
  notes: string
  recurring_id: string | null
  occurrence_date: string | null
  installment_number: number | null
  created_at: string
  updated_at: string
}

interface RuleRow {
  id: string
  concept: string
  amount_cents: number
  type: MovementType
  category_id: string
  frequency: Frequency
  start_date: string
  end_date: string | null
  installments: number | null
  notes: string
  created_at: string
  updated_at: string
}

const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  type: r.type,
  parentId: r.parent_id,
  order: r.order_index,
  budgetCents: r.budget_cents,
})

const toMovement = (r: MovementRow): Movement => ({
  id: r.id,
  concept: r.concept,
  amountCents: r.amount_cents,
  type: r.type,
  categoryId: r.category_id,
  status: r.status,
  paidDate: r.paid_date,
  dueDate: r.due_date,
  notes: r.notes,
  recurringId: r.recurring_id,
  occurrenceDate: r.occurrence_date,
  installmentNumber: r.installment_number,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const toRule = (r: RuleRow, excludedDates: ISODate[]): RecurringRule => ({
  id: r.id,
  concept: r.concept,
  amountCents: r.amount_cents,
  type: r.type,
  categoryId: r.category_id,
  frequency: r.frequency,
  startDate: r.start_date,
  endDate: r.end_date,
  installments: r.installments,
  notes: r.notes,
  excludedDates,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const categoryParams = (c: Category) => ({
  id: c.id,
  name: c.name,
  type: c.type,
  parent_id: c.parentId,
  order_index: c.order,
  budget_cents: c.budgetCents,
})

const movementParams = (m: Movement) => ({
  id: m.id,
  concept: m.concept,
  amount_cents: m.amountCents,
  type: m.type,
  category_id: m.categoryId,
  status: m.status,
  paid_date: m.paidDate,
  due_date: m.dueDate,
  notes: m.notes,
  recurring_id: m.recurringId,
  occurrence_date: m.occurrenceDate,
  installment_number: m.installmentNumber,
  created_at: m.createdAt,
  updated_at: m.updatedAt,
})

const ruleParams = (r: RecurringRule) => ({
  id: r.id,
  concept: r.concept,
  amount_cents: r.amountCents,
  type: r.type,
  category_id: r.categoryId,
  frequency: r.frequency,
  start_date: r.startDate,
  end_date: r.endDate,
  installments: r.installments,
  notes: r.notes,
  created_at: r.createdAt,
  updated_at: r.updatedAt,
})

const CATEGORY_COLUMNS = 'id, name, type, parent_id, order_index, budget_cents'
const MOVEMENT_COLUMNS =
  'id, concept, amount_cents, type, category_id, status, paid_date, due_date, notes, recurring_id, occurrence_date, installment_number, created_at, updated_at'
const RULE_COLUMNS = 'id, concept, amount_cents, type, category_id, frequency, start_date, end_date, installments, notes, created_at, updated_at'

/** "a, b" -> "@a, @b" */
const named = (columns: string) =>
  columns
    .split(', ')
    .map((c) => `@${c}`)
    .join(', ')
/** "id, a, b" -> "a = excluded.a, b = excluded.b" (para actualizar si el id ya existe) */
const updateAll = (columns: string) =>
  columns
    .split(', ')
    .filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Database.SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE'
}

const typeLabel = (type: MovementType) => (type === 'gasto' ? 'gastos' : 'ingresos')

/** Sentencias preparadas una sola vez por conexión. */
function prepareStatements(db: Database.Database) {
  return {
    allCategories: db.prepare<[], CategoryRow>(`SELECT ${CATEGORY_COLUMNS} FROM categories ORDER BY id`),
    allMovements: db.prepare<[], MovementRow>(`SELECT ${MOVEMENT_COLUMNS} FROM movements ORDER BY id`),
    allRules: db.prepare<[], RuleRow>(`SELECT ${RULE_COLUMNS} FROM recurring_rules ORDER BY id`),
    allExcluded: db.prepare<[], { rule_id: string; date: string }>(
      'SELECT rule_id, date FROM recurring_excluded_dates ORDER BY rule_id, date',
    ),
    category: db.prepare<[string], CategoryRow>(`SELECT ${CATEGORY_COLUMNS} FROM categories WHERE id = ?`),
    childCount: db.prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?'),
    upsertCategory: db.prepare(
      `INSERT INTO categories (${CATEGORY_COLUMNS}) VALUES (${named(CATEGORY_COLUMNS)})
       ON CONFLICT (id) DO UPDATE SET ${updateAll(CATEGORY_COLUMNS)}`,
    ),
    movement: db.prepare<[string], MovementRow>(`SELECT ${MOVEMENT_COLUMNS} FROM movements WHERE id = ?`),
    movementsOfRule: db.prepare<[string], MovementRow>(
      `SELECT ${MOVEMENT_COLUMNS} FROM movements WHERE recurring_id = ? ORDER BY id`,
    ),
    insertMovement: db.prepare(`INSERT INTO movements (${MOVEMENT_COLUMNS}) VALUES (${named(MOVEMENT_COLUMNS)})`),
    upsertMovement: db.prepare(
      `INSERT INTO movements (${MOVEMENT_COLUMNS}) VALUES (${named(MOVEMENT_COLUMNS)})
       ON CONFLICT (id) DO UPDATE SET ${updateAll(MOVEMENT_COLUMNS)}`,
    ),
    deleteMovement: db.prepare<[string]>('DELETE FROM movements WHERE id = ?'),
    deletePendingOfRule: db.prepare<[string]>("DELETE FROM movements WHERE recurring_id = ? AND status = 'pendiente'"),
    rule: db.prepare<[string], RuleRow>(`SELECT ${RULE_COLUMNS} FROM recurring_rules WHERE id = ?`),
    upsertRule: db.prepare(
      `INSERT INTO recurring_rules (${RULE_COLUMNS}) VALUES (${named(RULE_COLUMNS)})
       ON CONFLICT (id) DO UPDATE SET ${updateAll(RULE_COLUMNS)}`,
    ),
    deleteRule: db.prepare<[string]>('DELETE FROM recurring_rules WHERE id = ?'),
    excludedOfRule: db.prepare<[string], { date: string }>(
      'SELECT date FROM recurring_excluded_dates WHERE rule_id = ? ORDER BY date',
    ),
    insertExcluded: db.prepare<[string, string]>('INSERT OR IGNORE INTO recurring_excluded_dates (rule_id, date) VALUES (?, ?)'),
    deleteExcludedOfRule: db.prepare<[string]>('DELETE FROM recurring_excluded_dates WHERE rule_id = ?'),
    getMeta: db.prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare<[string, string]>(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    ),
  }
}

export class SqliteFinanceRepository implements FinanceRepository {
  private readonly ctx: SqliteContext
  private readonly sql: ReturnType<typeof prepareStatements>

  constructor(ctx: SqliteContext) {
    this.ctx = ctx
    this.sql = prepareStatements(ctx.db)
  }

  private get db() {
    return this.ctx.db
  }

  private now(): string {
    return this.ctx.now()
  }

  private newId = (): string => this.ctx.newId()

  private transaction<T>(work: () => T): T {
    return this.ctx.transaction(work)
  }

  private readAll(): FinanceData {
    const excluded = new Map<string, ISODate[]>()
    for (const row of this.sql.allExcluded.all()) {
      const dates = excluded.get(row.rule_id) ?? []
      dates.push(row.date)
      excluded.set(row.rule_id, dates)
    }
    return {
      categories: this.sql.allCategories.all().map(toCategory),
      movements: this.sql.allMovements.all().map(toMovement),
      recurring: this.sql.allRules.all().map((row) => toRule(row, excluded.get(row.id) ?? [])),
    }
  }

  /** El movimiento o recurrente debe usar una categoría que exista y sea de su mismo tipo. */
  private requireCategory(categoryId: string, type: MovementType, label: string): void {
    const category = this.sql.category.get(categoryId)
    if (!category) throw new AppError('VALIDATION', `${label} usa una categoría que no existe.`)
    if (category.type !== type) {
      throw new AppError('VALIDATION', `${label} es de ${typeLabel(type)}, pero su categoría es de ${typeLabel(category.type)}.`)
    }
  }

  private insertOccurrence(movement: Movement): void {
    try {
      this.sql.insertMovement.run(movementParams(movement))
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('CONFLICT', 'Ese vencimiento ya existe, así que no se ha creado otro.')
      throw error
    }
  }

  /** Borra todo y escribe `data` (sin transacción propia: la abre quien llama). */
  private writeAll(data: FinanceData): void {
    this.db.exec('DELETE FROM movements; DELETE FROM recurring_rules; DELETE FROM categories;')
    // Primero las categorías principales, para que las subcategorías encuentren a su padre.
    const parentsFirst = [...data.categories].sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null))
    for (const category of parentsFirst) this.sql.upsertCategory.run(categoryParams(category))
    for (const rule of data.recurring) {
      this.sql.upsertRule.run(ruleParams(rule))
      for (const date of rule.excludedDates) this.sql.insertExcluded.run(rule.id, date)
    }
    for (const movement of data.movements) this.sql.insertMovement.run(movementParams(movement))
  }

  async loadAll(): Promise<FinanceData> {
    return this.transaction(() => this.readAll())
  }

  async saveMovement(movement: Movement): Promise<void> {
    this.transaction(() => {
      this.requireCategory(movement.categoryId, movement.type, 'El movimiento')
      try {
        this.sql.upsertMovement.run(movementParams(movement))
      } catch (error) {
        if (isUniqueViolation(error)) throw new AppError('CONFLICT', 'Ese vencimiento ya existe, así que no se ha creado otro.')
        throw error
      }
    })
  }

  async deleteMovement(id: string): Promise<void> {
    this.transaction(() => {
      const movement = this.sql.movement.get(id)
      if (!movement) return
      // Si es un vencimiento de un recurrente, se recuerda su fecha para no volver a crearlo.
      if (movement.recurring_id && movement.occurrence_date && this.sql.rule.get(movement.recurring_id)) {
        this.sql.insertExcluded.run(movement.recurring_id, movement.occurrence_date)
      }
      this.sql.deleteMovement.run(id)
    })
  }

  async saveCategory(category: Category): Promise<void> {
    this.transaction(() => {
      if (category.parentId !== null) {
        const parent = this.sql.category.get(category.parentId)
        if (category.parentId === category.id || !parent) {
          throw new AppError('VALIDATION', 'La categoría principal no existe.')
        }
        if (parent.parent_id !== null) throw new AppError('VALIDATION', 'Solo hay un nivel de subcategorías.')
        if (parent.type !== category.type) {
          throw new AppError('VALIDATION', 'La subcategoría debe ser del mismo tipo que su categoría principal.')
        }
        if ((this.sql.childCount.get(category.id)?.n ?? 0) > 0) {
          throw new AppError('VALIDATION', 'Una categoría con subcategorías no puede pasar a ser subcategoría.')
        }
      }
      const existing = this.sql.category.get(category.id)
      if (existing && existing.type !== category.type) {
        throw new AppError('CONFLICT', 'No se puede cambiar una categoría de gastos a ingresos ni al revés.')
      }
      this.sql.upsertCategory.run(categoryParams(category))
    })
  }

  async deleteCategory(id: string, replacementId: string | null): Promise<void> {
    this.transaction(() => {
      const all = this.sql.allCategories.all().map(toCategory)
      const removed = withDescendants(all, id)
      const target = all.find((c) => c.id === id)
      const replacement = replacementId ? all.find((c) => c.id === replacementId) : undefined
      // Las comprobaciones se hacen antes de escribir nada.
      if (target && replacementId && (!replacement || replacement.type !== target.type || removed.includes(replacementId))) {
        throw new AppError('VALIDATION', 'La categoría de destino no es válida.')
      }

      const inList = placeholders(removed.length)
      const count = (table: 'movements' | 'recurring_rules') =>
        (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE category_id IN (${inList})`).get(...removed) as { n: number }).n
      const affected = count('movements') + count('recurring_rules')
      if (affected > 0 && !replacementId) {
        throw new AppError('CONFLICT', 'La categoría tiene movimientos: elige a qué categoría pasarlos.')
      }
      if (affected > 0) {
        const now = this.now()
        for (const table of ['movements', 'recurring_rules'] as const) {
          this.db
            .prepare(`UPDATE ${table} SET category_id = ?, updated_at = ? WHERE category_id IN (${inList})`)
            .run(replacementId, now, ...removed)
        }
      }
      this.db.prepare(`DELETE FROM categories WHERE id IN (${inList})`).run(...removed)
    })
  }

  async saveRecurring(rule: RecurringRule, options: SaveRecurringOptions): Promise<number> {
    return this.transaction(() => {
      this.requireCategory(rule.categoryId, rule.type, 'El recurrente')
      this.sql.upsertRule.run(ruleParams(rule))
      this.sql.deleteExcludedOfRule.run(rule.id)
      for (const date of rule.excludedDates) this.sql.insertExcluded.run(rule.id, date)

      // Los vencimientos pendientes se rehacen con los datos nuevos; los pagados se conservan.
      const kept = this.sql.movementsOfRule
        .all(rule.id)
        .map(toMovement)
        .filter((m) => m.status !== 'pendiente')
      this.sql.deletePendingOfRule.run(rule.id)

      const planned = planOccurrences(rule, kept, options.horizon, this.now(), this.newId)
      for (const movement of planned) {
        const paidAlready = options.markPaidBefore && (movement.occurrenceDate as string) < options.markPaidBefore
        this.insertOccurrence(paidAlready ? { ...movement, status: 'realizado', paidDate: movement.occurrenceDate } : movement)
      }
      return planned.length
    })
  }

  async deleteRecurring(id: string): Promise<void> {
    this.transaction(() => {
      // Sus fechas excluidas se borran en cascada; los vencimientos pagados se conservan.
      this.sql.deleteRule.run(id)
      this.sql.deletePendingOfRule.run(id)
    })
  }

  async generateOccurrences(horizon: ISODate): Promise<number> {
    return this.transaction(() => {
      const now = this.now()
      let created = 0
      for (const row of this.sql.allRules.all()) {
        const rule = toRule(row, this.sql.excludedOfRule.all(row.id).map((r) => r.date))
        const own = this.sql.movementsOfRule.all(rule.id).map(toMovement)
        for (const movement of planOccurrences(rule, own, horizon, now, this.newId)) {
          this.insertOccurrence(movement)
          created++
        }
      }
      return created
    })
  }

  async replaceAll(data: FinanceData): Promise<void> {
    this.transaction(() => this.writeAll(data))
  }

  async getMeta(key: MetaKey): Promise<string | null> {
    return this.sql.getMeta.get(key)?.value ?? null
  }

  async setMeta(key: MetaKey, value: string): Promise<void> {
    this.sql.setMeta.run(key, value)
  }

  /** Deja la base de datos como recién creada (solo para las pruebas). */
  async reset(): Promise<void> {
    this.transaction(() => {
      this.writeAll({ categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), movements: [], recurring: [] })
      this.db.exec('DELETE FROM meta')
    })
  }

  /** Cierra la conexión (en los tests, para simular cerrar la app). */
  close(): void {
    this.ctx.close()
  }
}
