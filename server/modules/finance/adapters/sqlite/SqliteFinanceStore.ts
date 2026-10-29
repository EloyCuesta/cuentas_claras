import Database from 'better-sqlite3'
import type { ISODate } from '#shared/common/types.ts'
import { DEFAULT_CATEGORIES } from '#shared/finance/categories.ts'
import type { MetaKey } from '#shared/finance/meta.ts'
import type {
  Category,
  FinanceData,
  Frequency,
  Movement,
  MovementStatus,
  MovementType,
  RecurringRule,
} from '#shared/finance/types.ts'
import { AppError } from '../../../../common/errors.ts'
import type { FinanceStore } from '../../application/ports.ts'

/**
 * Las finanzas en SQLite (tablas categories, movements, recurring_rules,
 * recurring_excluded_dates y meta).
 *
 * Solo SQL y conversión de filas: las reglas (categorías del mismo tipo,
 * planificar vencimientos, no importar encima de datos…) y las transacciones
 * están en los casos de uso (application/). Todas las consultas usan
 * parámetros (?, @nombre), también las listas IN (...): ningún dato del
 * usuario se concatena en el SQL. Los nombres de tabla que sí se concatenan
 * son constantes de este archivo.
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

/** "?, ?, ?" con tantos parámetros como valores (para IN (...)). */
const placeholders = (values: readonly unknown[]) => values.map(() => '?').join(', ')

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Database.SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE'
}

/** El índice único (recurring_id, occurrence_date) impide crear dos veces el mismo vencimiento. */
const duplicateOccurrence = () => new AppError('CONFLICT', 'Ese vencimiento ya existe, así que no se ha creado otro.')

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
    insertExcluded: db.prepare<[string, string]>('INSERT OR IGNORE INTO recurring_excluded_dates (rule_id, date) VALUES (?, ?)'),
    deleteExcludedOfRule: db.prepare<[string]>('DELETE FROM recurring_excluded_dates WHERE rule_id = ?'),
    getMeta: db.prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare<[string, string]>(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    ),
  }
}

export class SqliteFinanceStore implements FinanceStore {
  private readonly db: Database.Database
  private readonly sql: ReturnType<typeof prepareStatements>

  constructor(db: Database.Database) {
    this.db = db
    this.sql = prepareStatements(db)
  }

  /** Fechas excluidas de cada recurrente, en orden. */
  private excludedByRule(): Map<string, ISODate[]> {
    const excluded = new Map<string, ISODate[]>()
    for (const row of this.sql.allExcluded.all()) {
      const dates = excluded.get(row.rule_id) ?? []
      dates.push(row.date)
      excluded.set(row.rule_id, dates)
    }
    return excluded
  }

  readAll(): FinanceData {
    const excluded = this.excludedByRule()
    return {
      categories: this.sql.allCategories.all().map(toCategory),
      movements: this.sql.allMovements.all().map(toMovement),
      recurring: this.sql.allRules.all().map((row) => toRule(row, excluded.get(row.id) ?? [])),
    }
  }

  writeAll(data: FinanceData): void {
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

  /* Categorías ------------------------------------------------------------ */

  listCategories(): Category[] {
    return this.sql.allCategories.all().map(toCategory)
  }

  getCategory(id: string): Category | null {
    const row = this.sql.category.get(id)
    return row ? toCategory(row) : null
  }

  countChildren(categoryId: string): number {
    return this.sql.childCount.get(categoryId)?.n ?? 0
  }

  upsertCategory(category: Category): void {
    this.sql.upsertCategory.run(categoryParams(category))
  }

  countCategoryUsage(categoryIds: readonly string[]): number {
    const inList = placeholders(categoryIds)
    const count = (table: 'movements' | 'recurring_rules') =>
      (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE category_id IN (${inList})`).get(...categoryIds) as { n: number }).n
    return count('movements') + count('recurring_rules')
  }

  reassignCategories(categoryIds: readonly string[], replacementId: string, now: string): void {
    const inList = placeholders(categoryIds)
    for (const table of ['movements', 'recurring_rules'] as const) {
      this.db
        .prepare(`UPDATE ${table} SET category_id = ?, updated_at = ? WHERE category_id IN (${inList})`)
        .run(replacementId, now, ...categoryIds)
    }
  }

  deleteCategories(categoryIds: readonly string[]): void {
    this.db.prepare(`DELETE FROM categories WHERE id IN (${placeholders(categoryIds)})`).run(...categoryIds)
  }

  /* Movimientos ----------------------------------------------------------- */

  getMovement(id: string): Movement | null {
    const row = this.sql.movement.get(id)
    return row ? toMovement(row) : null
  }

  movementsOfRule(ruleId: string): Movement[] {
    return this.sql.movementsOfRule.all(ruleId).map(toMovement)
  }

  insertOccurrence(movement: Movement): void {
    try {
      this.sql.insertMovement.run(movementParams(movement))
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateOccurrence()
      throw error
    }
  }

  upsertMovement(movement: Movement): void {
    try {
      this.sql.upsertMovement.run(movementParams(movement))
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateOccurrence()
      throw error
    }
  }

  deleteMovement(id: string): void {
    this.sql.deleteMovement.run(id)
  }

  deletePendingOfRule(ruleId: string): void {
    this.sql.deletePendingOfRule.run(ruleId)
  }

  /* Recurrentes ----------------------------------------------------------- */

  listRules(): RecurringRule[] {
    const excluded = this.excludedByRule()
    return this.sql.allRules.all().map((row) => toRule(row, excluded.get(row.id) ?? []))
  }

  hasRule(id: string): boolean {
    return this.sql.rule.get(id) !== undefined
  }

  upsertRule(rule: RecurringRule): void {
    this.sql.upsertRule.run(ruleParams(rule))
  }

  deleteRule(id: string): void {
    this.sql.deleteRule.run(id)
  }

  addExcludedDate(ruleId: string, date: ISODate): void {
    this.sql.insertExcluded.run(ruleId, date)
  }

  clearExcludedDates(ruleId: string): void {
    this.sql.deleteExcludedOfRule.run(ruleId)
  }

  /* Metadatos ------------------------------------------------------------- */

  getMeta(key: MetaKey): string | null {
    return this.sql.getMeta.get(key)?.value ?? null
  }

  setMeta(key: MetaKey, value: string): void {
    this.sql.setMeta.run(key, value)
  }

  reset(): void {
    this.writeAll({ categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), movements: [], recurring: [] })
    this.db.exec('DELETE FROM meta')
  }
}
