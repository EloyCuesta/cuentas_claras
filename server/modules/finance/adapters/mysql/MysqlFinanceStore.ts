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
import { duplicateKeyName } from '../../../../common/mysql/errors.ts'
import type { MysqlDatabase, SqlParam } from '../../../../common/mysql/MysqlDatabase.ts'
import type { FinanceStore } from '../../application/ports.ts'

/**
 * Las finanzas en MySQL (tablas categories, movements, recurring_rules,
 * recurring_excluded_dates y meta).
 *
 * Solo SQL y conversión de filas: las reglas (categorías del mismo tipo,
 * planificar vencimientos, no importar encima de datos…), las transacciones y
 * el bloqueo «finance» están en los casos de uso (application/). Todas las
 * consultas usan parámetros (?), también las listas IN (...): ningún dato del
 * usuario se concatena en el SQL. Los nombres de tabla y columna que sí se
 * concatenan son constantes de este archivo.
 *
 * - Las fechas llegan como texto AAAA-MM-DD (DATE con dateStrings) y los
 *   céntimos como números (BIGINT dentro de MAX_CENTS).
 * - «key» es palabra reservada en MySQL: va entre comillas invertidas.
 * - movements tiene dos claves únicas (id y recurrente + fecha): se actualiza
 *   o se inserta por id, nunca con ON DUPLICATE KEY UPDATE, que con un
 *   vencimiento repetido sobrescribiría el otro movimiento en vez de dar 409.
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

/** Los valores de cada fila en el orden de sus columnas (CATEGORY_COLUMNS, MOVEMENT_COLUMNS, RULE_COLUMNS). */
const categoryValues = (c: Category): SqlParam[] => [c.id, c.name, c.type, c.parentId, c.order, c.budgetCents]

const movementValues = (m: Movement): SqlParam[] => [
  m.id,
  m.concept,
  m.amountCents,
  m.type,
  m.categoryId,
  m.status,
  m.paidDate,
  m.dueDate,
  m.notes,
  m.recurringId,
  m.occurrenceDate,
  m.installmentNumber,
  m.createdAt,
  m.updatedAt,
]

const ruleValues = (r: RecurringRule): SqlParam[] => [
  r.id,
  r.concept,
  r.amountCents,
  r.type,
  r.categoryId,
  r.frequency,
  r.startDate,
  r.endDate,
  r.installments,
  r.notes,
  r.createdAt,
  r.updatedAt,
]

const CATEGORY_COLUMNS = 'id, name, type, parent_id, order_index, budget_cents'
const MOVEMENT_COLUMNS =
  'id, concept, amount_cents, type, category_id, status, paid_date, due_date, notes, recurring_id, occurrence_date, installment_number, created_at, updated_at'
const RULE_COLUMNS = 'id, concept, amount_cents, type, category_id, frequency, start_date, end_date, installments, notes, created_at, updated_at'

/** "?, ?, ?" con tantos parámetros como valores (para VALUES e IN (...)). */
const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ')
const columnsOf = (columns: string) => columns.split(', ')

/** INSERT … AS new ON DUPLICATE KEY UPDATE de todas las columnas menos el id: solo para tablas sin otra clave única. */
const upsertSql = (table: string, columns: string) =>
  `INSERT INTO ${table} (${columns}) VALUES (${placeholders(columnsOf(columns).length)}) AS new
   ON DUPLICATE KEY UPDATE ${columnsOf(columns)
     .filter((c) => c !== 'id')
     .map((c) => `${c} = new.${c}`)
     .join(', ')}`

const UPSERT_CATEGORY = upsertSql('categories', CATEGORY_COLUMNS)
const UPSERT_RULE = upsertSql('recurring_rules', RULE_COLUMNS)
const INSERT_MOVEMENT = `INSERT INTO movements (${MOVEMENT_COLUMNS}) VALUES (${placeholders(columnsOf(MOVEMENT_COLUMNS).length)})`
const UPDATE_MOVEMENT = `UPDATE movements SET ${columnsOf(MOVEMENT_COLUMNS)
  .filter((c) => c !== 'id')
  .map((c) => `${c} = ?`)
  .join(', ')} WHERE id = ?`
// INSERT OR IGNORE de SQLite: la clave repetida se queda como está. INSERT IGNORE no vale: también se traga un fallo de clave foránea.
const INSERT_EXCLUDED = 'INSERT INTO recurring_excluded_dates (rule_id, date) VALUES (?, ?) ON DUPLICATE KEY UPDATE rule_id = rule_id'

/** El índice único (recurring_id, occurrence_date) impide crear dos veces el mismo vencimiento. */
const duplicateOccurrence = () => new AppError('CONFLICT', 'Ese vencimiento ya existe, así que no se ha creado otro.')

/** Traduce el choque con un vencimiento que ya existe; cualquier otro error sigue su camino (el 409 genérico o un 500). */
async function translatingOccurrences(write: () => Promise<unknown>): Promise<void> {
  try {
    await write()
  } catch (error) {
    if (duplicateKeyName(error) === 'movements_occurrence') throw duplicateOccurrence()
    throw error
  }
}

export class MysqlFinanceStore implements FinanceStore {
  private readonly db: MysqlDatabase

  constructor(db: MysqlDatabase) {
    this.db = db
  }

  /** Fechas excluidas de cada recurrente, en orden. */
  private async excludedByRule(): Promise<Map<string, ISODate[]>> {
    const excluded = new Map<string, ISODate[]>()
    const rows = await this.db.rows<{ rule_id: string; date: string }>(
      'SELECT rule_id, date FROM recurring_excluded_dates ORDER BY rule_id, date',
    )
    for (const row of rows) {
      const dates = excluded.get(row.rule_id) ?? []
      dates.push(row.date)
      excluded.set(row.rule_id, dates)
    }
    return excluded
  }

  private async allRules(): Promise<RecurringRule[]> {
    const excluded = await this.excludedByRule()
    const rows = await this.db.rows<RuleRow>(`SELECT ${RULE_COLUMNS} FROM recurring_rules ORDER BY id`)
    return rows.map((row) => toRule(row, excluded.get(row.id) ?? []))
  }

  async readAll(): Promise<FinanceData> {
    const categories = await this.listCategories()
    const movements = await this.db.rows<MovementRow>(`SELECT ${MOVEMENT_COLUMNS} FROM movements ORDER BY id`)
    const recurring = await this.allRules()
    return { categories, movements: movements.map(toMovement), recurring }
  }

  async writeAll(data: FinanceData): Promise<void> {
    // Una sentencia por llamada: primero lo que apunta a las categorías.
    await this.db.run('DELETE FROM movements')
    await this.db.run('DELETE FROM recurring_rules')
    await this.db.run('DELETE FROM categories')
    // Primero las categorías principales, para que las subcategorías encuentren a su padre.
    const parentsFirst = [...data.categories].sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null))
    for (const category of parentsFirst) await this.db.run(UPSERT_CATEGORY, categoryValues(category))
    for (const rule of data.recurring) {
      await this.db.run(UPSERT_RULE, ruleValues(rule))
      for (const date of rule.excludedDates) await this.db.run(INSERT_EXCLUDED, [rule.id, date])
    }
    for (const movement of data.movements) await this.db.run(INSERT_MOVEMENT, movementValues(movement))
  }

  /* Categorías ------------------------------------------------------------ */

  async listCategories(): Promise<Category[]> {
    return (await this.db.rows<CategoryRow>(`SELECT ${CATEGORY_COLUMNS} FROM categories ORDER BY id`)).map(toCategory)
  }

  async getCategory(id: string): Promise<Category | null> {
    const [row] = await this.db.rows<CategoryRow>(`SELECT ${CATEGORY_COLUMNS} FROM categories WHERE id = ?`, [id])
    return row ? toCategory(row) : null
  }

  async countChildren(categoryId: string): Promise<number> {
    const [row] = await this.db.rows<{ n: number }>('SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?', [categoryId])
    return row?.n ?? 0
  }

  async upsertCategory(category: Category): Promise<void> {
    await this.db.run(UPSERT_CATEGORY, categoryValues(category))
  }

  async countCategoryUsage(categoryIds: readonly string[]): Promise<number> {
    if (categoryIds.length === 0) return 0
    const inList = placeholders(categoryIds.length)
    let total = 0
    for (const table of ['movements', 'recurring_rules'] as const) {
      const [row] = await this.db.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE category_id IN (${inList})`, categoryIds)
      total += row?.n ?? 0
    }
    return total
  }

  async reassignCategories(categoryIds: readonly string[], replacementId: string, now: string): Promise<void> {
    if (categoryIds.length === 0) return
    const inList = placeholders(categoryIds.length)
    for (const table of ['movements', 'recurring_rules'] as const) {
      await this.db.run(`UPDATE ${table} SET category_id = ?, updated_at = ? WHERE category_id IN (${inList})`, [
        replacementId,
        now,
        ...categoryIds,
      ])
    }
  }

  async deleteCategories(categoryIds: readonly string[]): Promise<void> {
    if (categoryIds.length === 0) return
    await this.db.run(`DELETE FROM categories WHERE id IN (${placeholders(categoryIds.length)})`, categoryIds)
  }

  /* Movimientos ----------------------------------------------------------- */

  async getMovement(id: string): Promise<Movement | null> {
    const [row] = await this.db.rows<MovementRow>(`SELECT ${MOVEMENT_COLUMNS} FROM movements WHERE id = ?`, [id])
    return row ? toMovement(row) : null
  }

  async movementsOfRule(ruleId: string): Promise<Movement[]> {
    const rows = await this.db.rows<MovementRow>(`SELECT ${MOVEMENT_COLUMNS} FROM movements WHERE recurring_id = ? ORDER BY id`, [ruleId])
    return rows.map(toMovement)
  }

  insertOccurrence(movement: Movement): Promise<void> {
    return translatingOccurrences(() => this.db.run(INSERT_MOVEMENT, movementValues(movement)))
  }

  upsertMovement(movement: Movement): Promise<void> {
    return translatingOccurrences(async () => {
      const [id, ...rest] = movementValues(movement)
      // affectedRows cuenta las filas encontradas, aunque no cambien: 0 es que no existe ese id.
      const updated = await this.db.run(UPDATE_MOVEMENT, [...rest, id])
      if (updated.affectedRows === 0) await this.db.run(INSERT_MOVEMENT, movementValues(movement))
    })
  }

  async deleteMovement(id: string): Promise<void> {
    await this.db.run('DELETE FROM movements WHERE id = ?', [id])
  }

  async deletePendingOfRule(ruleId: string): Promise<void> {
    await this.db.run("DELETE FROM movements WHERE recurring_id = ? AND status = 'pendiente'", [ruleId])
  }

  /* Recurrentes ----------------------------------------------------------- */

  listRules(): Promise<RecurringRule[]> {
    return this.allRules()
  }

  async hasRule(id: string): Promise<boolean> {
    return (await this.db.rows('SELECT id FROM recurring_rules WHERE id = ?', [id])).length > 0
  }

  async upsertRule(rule: RecurringRule): Promise<void> {
    await this.db.run(UPSERT_RULE, ruleValues(rule))
  }

  async deleteRule(id: string): Promise<void> {
    await this.db.run('DELETE FROM recurring_rules WHERE id = ?', [id])
  }

  async addExcludedDate(ruleId: string, date: ISODate): Promise<void> {
    await this.db.run(INSERT_EXCLUDED, [ruleId, date])
  }

  async clearExcludedDates(ruleId: string): Promise<void> {
    await this.db.run('DELETE FROM recurring_excluded_dates WHERE rule_id = ?', [ruleId])
  }

  /* Metadatos ------------------------------------------------------------- */

  async getMeta(key: MetaKey): Promise<string | null> {
    const [row] = await this.db.rows<{ value: string }>('SELECT value FROM meta WHERE `key` = ?', [key])
    return row?.value ?? null
  }

  async setMeta(key: MetaKey, value: string): Promise<void> {
    await this.db.run('INSERT INTO meta (`key`, value) VALUES (?, ?) AS new ON DUPLICATE KEY UPDATE value = new.value', [key, value])
  }

  async reset(): Promise<void> {
    await this.writeAll({ categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), movements: [], recurring: [] })
    await this.db.run('DELETE FROM meta')
  }
}
