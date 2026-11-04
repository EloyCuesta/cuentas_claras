import { createHash } from 'node:crypto'
import type { TargetColumn } from './columns.ts'
import { byCodePoint, IMPORT_TABLES, keyOf, type ImportTable, type Row } from './tables.ts'

/**
 * Comparar la copia de SQLite con lo que hay en MySQL, fila a fila: cada fila
 * se convierte en un JSON normalizado (las columnas en su orden; los DECIMAL
 * como texto con sus decimales, «0.300»; el resto, tal cual) y cada tabla
 * tiene una huella SHA-256 de sus filas ordenadas por clave. El informe guarda
 * claves, recuentos, huellas, nulos y sumas, pero no los textos de las filas.
 */

/** El valor de una columna, igual venga de SQLite o de MySQL. */
export function canonical(value: unknown, column: TargetColumn): unknown {
  if (value === null || value === undefined) return null
  if (column.dataType === 'decimal') {
    const factor = 10 ** (column.scale ?? 0)
    return (Math.round(Number(value) * factor) / factor).toFixed(column.scale ?? 0)
  }
  if (typeof value === 'bigint') return value.toString()
  return value
}

export interface TableSnapshot {
  rows: number
  /** SHA-256 de «clave TAB fila» de cada fila, por clave. */
  hash: string
  /** Fila normalizada de cada clave. */
  byKey: Map<string, Row>
  /** Cuántos NULL hay en cada columna que admite NULL. */
  nulls: Record<string, number>
}

export function snapshot(table: ImportTable, columns: readonly TargetColumn[], rows: readonly Row[]): TableSnapshot {
  const byKey = new Map<string, Row>()
  const nulls: Record<string, number> = Object.fromEntries(columns.filter((c) => c.nullable).map((c) => [c.name, 0]))
  for (const row of rows) {
    const normalized: Row = {}
    for (const column of columns) {
      normalized[column.name] = canonical(row[column.name], column)
      if (normalized[column.name] === null && column.nullable) nulls[column.name]++
    }
    byKey.set(keyOf(table, normalized), normalized)
  }
  const hash = createHash('sha256')
  for (const key of [...byKey.keys()].sort(byCodePoint)) hash.update(`${key}\t${JSON.stringify(byKey.get(key))}\n`)
  return { rows: rows.length, hash: hash.digest('hex'), byKey, nulls }
}

export interface TableDifferences {
  /** Claves de la copia que no están en MySQL. */
  missing: string[]
  /** Claves de MySQL que no estaban en la copia. */
  extra: string[]
  /** Claves cuyas filas no coinciden, con las columnas distintas (sin sus valores). */
  changed: { key: string; columns: string[] }[]
}

export function differences(source: TableSnapshot, target: TableSnapshot): TableDifferences {
  const missing = [...source.byKey.keys()].filter((key) => !target.byKey.has(key)).sort(byCodePoint)
  const extra = [...target.byKey.keys()].filter((key) => !source.byKey.has(key)).sort(byCodePoint)
  const changed: TableDifferences['changed'] = []
  for (const [key, row] of source.byKey) {
    const other = target.byKey.get(key)
    if (!other) continue
    const columns = Object.keys(row).filter((column) => JSON.stringify(row[column]) !== JSON.stringify(other[column]))
    if (columns.length > 0) changed.push({ key, columns })
  }
  changed.sort((a, b) => byCodePoint(a.key, b.key))
  return { missing, extra, changed }
}

export const isEqual = (d: TableDifferences) => d.missing.length === 0 && d.extra.length === 0 && d.changed.length === 0

const milli = (value: unknown) => (value === null ? 0 : Math.round(Number(value) * 1000))
const cents = (value: unknown) => (value === null ? 0 : Number(value))
/** Cuántas filas hay de cada valor, con las claves ordenadas (el orden de las filas no cambia el resultado). */
function count(rows: readonly Row[], field: (row: Row) => string): Record<string, number> {
  const result: Record<string, number> = {}
  for (const row of rows) result[field(row)] = (result[field(row)] ?? 0) + 1
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => byCodePoint(a, b)))
}

/**
 * Sumas y recuentos para revisar el informe de un vistazo, calculados igual
 * con las filas normalizadas de la copia y con las de MySQL: céntimos por tipo,
 * estado y mes, cantidades y objetivos en milésimas, versiones, devoluciones,
 * pendientes, lo aprendido y los metadatos que hay.
 */
export function totals(snapshots: Record<string, TableSnapshot>) {
  const rows = (table: string) => [...(snapshots[table]?.byKey.values() ?? [])]
  const movements = rows('movements')
  const rules = rows('recurring_rules')
  const ruleIds = new Set(rules.map((rule) => rule.id))
  const byStatus: Record<string, { filas: number; centimos: number }> = {}
  const byMonth: Record<string, { ingresos: number; gastos: number }> = {}
  for (const m of movements) {
    const status = `${String(m.type)}/${String(m.status)}`
    byStatus[status] ??= { filas: 0, centimos: 0 }
    byStatus[status].filas++
    byStatus[status].centimos += cents(m.amount_cents)
    const month = String(m.status === 'realizado' ? m.paid_date : m.due_date).slice(0, 7)
    byMonth[month] ??= { ingresos: 0, gastos: 0 }
    byMonth[month][m.type === 'ingreso' ? 'ingresos' : 'gastos'] += cents(m.amount_cents)
  }
  const categories = rows('categories')
  const items = rows('pantry_items')
  const tickets = rows('pantry_tickets')
  const lines = rows('pantry_ticket_lines')
  const aliases = rows('pantry_aliases')
  const settings = rows('pantry_settings')[0]
  return {
    finanzas: {
      movimientos: Object.fromEntries(Object.entries(byStatus).sort(([a], [b]) => byCodePoint(a, b))),
      porMes: Object.fromEntries(Object.entries(byMonth).sort(([a], [b]) => byCodePoint(a, b))),
      vencimientos: {
        filas: movements.filter((m) => m.recurring_id !== null).length,
        deRecurrentesBorrados: movements.filter((m) => m.recurring_id !== null && !ruleIds.has(m.recurring_id)).length,
      },
      recurrentes: {
        filas: rules.length,
        centimos: rules.reduce((sum, r) => sum + cents(r.amount_cents), 0),
        conCuotas: rules.filter((r) => r.installments !== null).length,
      },
      fechasExcluidas: rows('recurring_excluded_dates').length,
      categorias: {
        principales: categories.filter((c) => c.parent_id === null).length,
        subcategorias: categories.filter((c) => c.parent_id !== null).length,
        presupuestoCentimos: categories.reduce((sum, c) => sum + cents(c.budget_cents), 0),
      },
    },
    despensa: {
      personas: rows('pantry_people').length,
      productos: {
        filas: items.length,
        compartidos: items.filter((i) => i.owner_id === null).length,
        porSeguimiento: count(items, (i) => String(i.tracking)),
        milesimasCantidad: items.reduce((sum, i) => sum + milli(i.quantity), 0),
        milesimasObjetivo: items.reduce((sum, i) => sum + milli(i.target), 0),
        sumaVersiones: items.reduce((sum, i) => sum + Number(i.version), 0),
        sinPrecio: items.filter((i) => i.price_cents === null).length,
      },
      revisiones: count(rows('pantry_events'), (e) => String(e.kind)),
      ajustes: settings
        ? { presupuestoCentimos: settings.monthly_budget_cents, ultimoRepaso: settings.last_review_date }
        : null,
    },
    tickets: {
      tickets: {
        filas: tickets.length,
        totalCentimos: tickets.reduce((sum, t) => sum + cents(t.total_cents), 0),
        sinTotal: tickets.filter((t) => t.total_cents === null).length,
        devoluciones: tickets.filter((t) => t.total_cents !== null && Number(t.total_cents) < 0).length,
        conImportId: tickets.filter((t) => t.import_id !== null).length,
        conHuellaDeOrigen: tickets.filter((t) => t.source_fingerprint !== null).length,
      },
      lineas: {
        filas: lines.length,
        importeCentimos: lines.reduce((sum, l) => sum + cents(l.amount_cents), 0),
        descuentoCentimos: lines.reduce((sum, l) => sum + cents(l.discount_cents), 0),
        gramos: lines.reduce((sum, l) => sum + milli(l.weight_kg), 0),
        pendientes: lines.filter((l) => l.review_status === 'pending').length,
        confirmadas: lines.filter((l) => Number(l.confirmed) === 1).length,
        conProducto: lines.filter((l) => l.item_id !== null).length,
        paraUnaOcasion: lines.filter((l) => Number(l.occasional) === 1).length,
        conEvidencia: lines.filter((l) => l.evidence_json !== null).length,
      },
      aprendido: {
        conProducto: aliases.filter((a) => a.item_id !== null).length,
        noSeSigue: aliases.filter((a) => a.item_id === null).length,
      },
    },
    metadatos: rows('meta')
      .map((row) => String(row.key))
      .sort(byCodePoint),
  }
}

export type Totals = ReturnType<typeof totals>

/** Las tablas en el orden de carga, con sus columnas de MySQL. */
export function tablesWithColumns(columns: Record<string, TargetColumn[]>) {
  return IMPORT_TABLES.map((table) => ({ table, columns: columns[table.name] ?? [] }))
}
