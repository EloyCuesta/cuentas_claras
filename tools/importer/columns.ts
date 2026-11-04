import { isValidISODate } from '#shared/common/dates.ts'
import type { MysqlDatabase } from '../../server/common/mysql/MysqlDatabase.ts'
import { IMPORT_TABLES, keyOf, type ImportTable, type Row } from './tables.ts'

/**
 * Las columnas de MySQL (information_schema de la base de destino, ya con la
 * migración 5) y la comprobación de que cada valor de la copia cabe en ellas
 * tal cual. MySQL en modo estricto rechaza lo que no cabe, pero un DECIMAL con
 * decimales de más lo redondearía sin avisar: por eso se comprueba antes de
 * escribir nada, fila a fila. Los mensajes dicen tabla, clave y columna, nunca
 * el valor.
 */

export interface TargetColumn {
  name: string
  dataType: string
  /** Caracteres de un VARCHAR; bytes de un MEDIUMTEXT. */
  maxLength: number | null
  precision: number | null
  scale: number | null
  nullable: boolean
}

interface ColumnRow {
  table_name: string
  name: string
  data_type: string
  max_length: number | null
  octet_length: number | null
  numeric_precision: number | null
  numeric_scale: number | null
  nullable: string
}

/** Las columnas de cada tabla del destino, en su orden. */
export async function targetColumns(db: MysqlDatabase): Promise<Record<string, TargetColumn[]>> {
  const rows = await db.rows<ColumnRow>(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS name, DATA_TYPE AS data_type, CHARACTER_MAXIMUM_LENGTH AS max_length,
       CHARACTER_OCTET_LENGTH AS octet_length, NUMERIC_PRECISION AS numeric_precision, NUMERIC_SCALE AS numeric_scale,
       IS_NULLABLE AS nullable
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  )
  const byTable: Record<string, TargetColumn[]> = {}
  for (const row of rows) {
    const dataType = row.data_type.toLowerCase()
    ;(byTable[row.table_name] ??= []).push({
      name: row.name,
      dataType,
      maxLength: dataType.endsWith('text') ? row.octet_length : row.max_length,
      precision: row.numeric_precision,
      scale: row.numeric_scale,
      nullable: row.nullable === 'YES',
    })
  }
  return byTable
}

/** Las columnas de la copia y las de MySQL tienen que ser las mismas, en el mismo orden. */
export function mappingProblems(source: Record<string, string[]>, target: Record<string, TargetColumn[]>): string[] {
  return IMPORT_TABLES.flatMap(({ name }) => {
    const expected = source[name] ?? []
    const actual = (target[name] ?? []).map((column) => column.name)
    return JSON.stringify(expected) === JSON.stringify(actual)
      ? []
      : [`${name}: en la copia tiene ${expected.join(', ') || 'ninguna columna'}; en MySQL, ${actual.join(', ') || 'no existe'}`]
  })
}

const INTEGER_RANGES: Record<string, [number, number]> = {
  tinyint: [-128, 127],
  smallint: [-32768, 32767],
  int: [-2147483648, 2147483647],
  bigint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
}

/** Por qué un valor no cabe tal cual en su columna de MySQL, o null si cabe. */
export function valueProblem(value: unknown, column: TargetColumn): string | null {
  if (value === null || value === undefined) return column.nullable ? null : 'está vacío (NULL) y en MySQL no puede'
  if (typeof value === 'bigint') return 'es un número entero demasiado grande para la aplicación'
  if (typeof value === 'object') return 'es un dato binario, no texto ni número'
  const type = column.dataType
  if (type === 'varchar' || type === 'char') {
    if (typeof value !== 'string') return `es un ${typeof value} y la columna es de texto`
    const length = [...value].length
    return column.maxLength !== null && length > column.maxLength ? `tiene ${length} caracteres y en MySQL caben ${column.maxLength}` : null
  }
  if (type.endsWith('text')) {
    if (typeof value !== 'string') return `es un ${typeof value} y la columna es de texto`
    const bytes = new TextEncoder().encode(value).length
    return column.maxLength !== null && bytes > column.maxLength ? `ocupa ${bytes} bytes y en MySQL caben ${column.maxLength}` : null
  }
  if (type in INTEGER_RANGES) {
    const [min, max] = INTEGER_RANGES[type]
    if (typeof value !== 'number' || !Number.isInteger(value)) return 'no es un número entero'
    return value < min || value > max ? `no cabe en un ${type.toUpperCase()} de MySQL` : null
  }
  if (type === 'decimal') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'no es un número'
    const scale = column.scale ?? 0
    const scaled = value * 10 ** scale
    // Un margen para el ruido de los REAL de SQLite (0,30000000000000004 son 300 milésimas).
    if (Math.abs(scaled - Math.round(scaled)) > 1e-6) return `tiene más de ${scale} decimales: MySQL lo redondearía`
    const digits = (column.precision ?? 0) - scale
    return Math.abs(Math.round(scaled)) >= 10 ** (column.precision ?? 0) ? `no cabe en DECIMAL(${column.precision},${scale}) (hasta ${digits} cifras enteras)` : null
  }
  if (type === 'double' || type === 'float') {
    return typeof value === 'number' && Number.isFinite(value) ? null : 'no es un número'
  }
  if (type === 'date') {
    return typeof value === 'string' && isValidISODate(value) ? null : 'no es una fecha que exista con la forma AAAA-MM-DD'
  }
  return `tiene un tipo de MySQL que el importador no conoce (${type})`
}

/** Todos los valores de la copia que no cabrían tal cual, con su tabla, su clave y su columna. */
export function rowProblems(rows: Record<string, Row[]>, columns: Record<string, TargetColumn[]>): string[] {
  const problems: string[] = []
  for (const table of IMPORT_TABLES) {
    for (const row of rows[table.name] ?? []) {
      for (const column of columns[table.name] ?? []) {
        const problem = valueProblem(row[column.name], column)
        if (problem) problems.push(`${table.name} ${describeKey(table, row)}: «${column.name}» ${problem}`)
      }
    }
  }
  return problems
}

/** La clave de una fila para un mensaje: «id x» o «(store, name_key) ["lidl","PAN"]». */
export function describeKey(table: ImportTable, row: Row): string {
  return table.key.length === 1 ? `${table.key[0]} ${keyOf(table, row)}` : `(${table.key.join(', ')}) ${keyOf(table, row)}`
}
