/**
 * Las doce tablas de la aplicación que pasan de SQLite a MySQL, en el orden de
 * carga: cada una después de las tablas a las que apuntan sus claves foráneas
 * (docs/migration/DATA.md). Mismos nombres y mismas columnas en los dos
 * motores: la migración 5 de MySQL las copió en el mismo orden.
 *
 * No se copian schema_migrations (cada motor tiene su historial) ni app_locks
 * (no son datos de la persona: los crea la migración de MySQL).
 */

export interface ImportTable {
  name: string
  /** Columnas de la clave primaria: identifican cada fila en el informe y en la comparación. */
  key: readonly string[]
}

export const IMPORT_TABLES: readonly ImportTable[] = [
  { name: 'categories', key: ['id'] },
  { name: 'recurring_rules', key: ['id'] },
  { name: 'recurring_excluded_dates', key: ['rule_id', 'date'] },
  { name: 'movements', key: ['id'] },
  { name: 'pantry_people', key: ['id'] },
  { name: 'pantry_items', key: ['id'] },
  { name: 'pantry_settings', key: ['id'] },
  { name: 'pantry_tickets', key: ['id'] },
  { name: 'pantry_ticket_lines', key: ['id'] },
  { name: 'pantry_aliases', key: ['store', 'name_key'] },
  { name: 'pantry_events', key: ['id'] },
  { name: 'meta', key: ['key'] },
]

/** Las tablas de una copia de cuentas.db en la versión 5: las doce y su historial. */
export const SQLITE_TABLES: readonly string[] = [...IMPORT_TABLES.map((table) => table.name), 'schema_migrations'].sort()

/** Las versiones de SQLite que tiene que tener aplicadas la copia. */
export const SQLITE_VERSIONS: readonly number[] = [1, 2, 3, 4, 5]

export type Row = Record<string, unknown>

/** La clave de una fila como texto, para el informe y los mapas («id» o «["lidl","LECHE"]»). */
export function keyOf(table: ImportTable, row: Row): string {
  return table.key.length === 1 ? String(row[table.key[0]]) : JSON.stringify(table.key.map((column) => row[column]))
}

/** Comparación por puntos de código, como utf8mb4_0900_bin (y como comparaba SQLite los bytes UTF-8). */
export function byCodePoint(a: string, b: string): number {
  const left = [...a]
  const right = [...b]
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = (left[i].codePointAt(0) ?? 0) - (right[i].codePointAt(0) ?? 0)
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

/**
 * Las categorías principales antes que las subcategorías (y, en general, cada
 * una después de su principal), para que la clave foránea parent_id encuentre
 * siempre a su padre al insertar.
 */
export function parentsFirst(rows: readonly Row[]): Row[] {
  const pending = [...rows]
  const placed = new Set<unknown>()
  const ordered: Row[] = []
  while (pending.length > 0) {
    const ready = pending.filter((row) => row.parent_id === null || placed.has(row.parent_id))
    // Una referencia que no lleva a ninguna principal: se deja para que la clave foránea lo diga.
    const batch = ready.length > 0 ? ready : pending
    for (const row of batch) {
      ordered.push(row)
      placed.add(row.id)
      pending.splice(pending.indexOf(row), 1)
    }
  }
  return ordered
}
