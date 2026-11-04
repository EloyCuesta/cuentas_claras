import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createSqlite, openSqliteReadOnly } from '../sqlite/openSqlite.ts'
import { IMPORT_TABLES, SQLITE_TABLES, SQLITE_VERSIONS, type Row } from './tables.ts'

/**
 * La copia de cuentas.db que se importa: se comprueba que es de Cuentas claras,
 * que está entera y que está en la versión 5, y se leen sus doce tablas.
 *
 * La copia de la persona solo se lee como archivo (para su huella SHA-256).
 * SQLite abre en solo lectura un duplicado en la carpeta temporal del sistema:
 * así no quedan archivos -wal ni -shm junto a la copia, y lo que se importa es
 * exactamente lo que tiene la huella.
 */

/** El importador no puede seguir: no se ha escrito nada en MySQL. `problems` dice qué y dónde, sin valores. */
export class ImportRefused extends Error {
  readonly problems: readonly string[]

  constructor(message: string, problems: readonly string[] = []) {
    super(message)
    this.name = 'ImportRefused'
    this.problems = problems
  }
}

export interface SourceCopy {
  /** Nombre del archivo (sin la carpeta, que puede llevar el nombre de la persona). */
  file: string
  bytes: number
  sha256: string
  schemaVersion: number
  /** Columnas de cada tabla, en su orden. */
  columns: Record<string, string[]>
  /** Filas de cada tabla. Los enteros que no caben en un número de JavaScript llegan como bigint. */
  rows: Record<string, Row[]>
}

interface ColumnInfo {
  name: string
  type: string
  notnull: number
  pk: number
}

const columnsOf = (db: Database.Database, table: string) => db.pragma(`table_info(${table})`) as ColumnInfo[]
const describe = (columns: ColumnInfo[]) => columns.map((c) => `${c.name} ${c.type}${c.notnull ? ' NOT NULL' : ''}${c.pk ? ` PK${c.pk}` : ''}`)

/** El esquema final de SQLite, el de sus migraciones 001–005, para comparar la copia con él. */
function referenceSchema(): Record<string, string[]> {
  const { db } = createSqlite(':memory:')
  try {
    return Object.fromEntries(SQLITE_TABLES.map((table) => [table, describe(columnsOf(db, table))]))
  } finally {
    db.close()
  }
}

/** Enteros como bigint (safeIntegers) para no perder precisión en silencio; los que caben pasan a número. */
function toPlainRow(row: Row): Row {
  const plain: Row = {}
  for (const [column, value] of Object.entries(row)) {
    plain[column] = typeof value === 'bigint' && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value
  }
  return plain
}

function check(db: Database.Database, file: string): { schemaVersion: number; columns: Record<string, string[]> } {
  const integrity = db.pragma('integrity_check', { simple: true })
  if (integrity !== 'ok') {
    throw new ImportRefused(`La copia «${file}» está dañada (integrity_check de SQLite: ${String(integrity)}). Vuelve a copiarla con la app parada.`)
  }
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(
    (row) => row.name,
  )
  if (!tables.includes('schema_migrations')) {
    throw new ImportRefused(`«${file}» no es una copia de Cuentas claras: no tiene el historial de migraciones (schema_migrations).`)
  }
  const versions = (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map((row) => Number(row.version))
  const schemaVersion = Math.max(0, ...versions)
  if (JSON.stringify(versions) !== JSON.stringify(SQLITE_VERSIONS)) {
    throw new ImportRefused(
      schemaVersion < 5
        ? `La copia está en la versión ${schemaVersion} del esquema de SQLite y el importador solo lee la 5. Ábrela antes una vez con la última versión de la app con SQLite, que la pone al día al arrancar, y vuelve a copiarla.`
        : `La copia tiene las migraciones de SQLite ${versions.join(', ')}, y el importador espera exactamente ${SQLITE_VERSIONS.join(', ')}.`,
    )
  }
  const missing = SQLITE_TABLES.filter((table) => !tables.includes(table))
  const extra = tables.filter((table) => !SQLITE_TABLES.includes(table))
  if (missing.length > 0 || extra.length > 0) {
    throw new ImportRefused('La copia no tiene las tablas de la versión 5.', [
      ...missing.map((table) => `falta la tabla ${table}`),
      ...extra.map((table) => `sobra la tabla ${table}, que no es de Cuentas claras`),
    ])
  }
  const reference = referenceSchema()
  const different = SQLITE_TABLES.filter((table) => JSON.stringify(describe(columnsOf(db, table))) !== JSON.stringify(reference[table]))
  if (different.length > 0) {
    throw new ImportRefused(
      'Las columnas de la copia no son las de la versión 5.',
      different.map((table) => `${table}: tiene ${describe(columnsOf(db, table)).join(', ')}; se esperaba ${reference[table].join(', ')}`),
    )
  }
  const brokenReferences = db.pragma('foreign_key_check') as { table: string; rowid: number; parent: string }[]
  if (brokenReferences.length > 0) {
    throw new ImportRefused(
      'La copia tiene referencias rotas (foreign_key_check de SQLite).',
      brokenReferences.slice(0, 20).map((row) => `${row.table} (fila ${row.rowid}) apunta a ${row.parent} que no existe`),
    )
  }
  return {
    schemaVersion,
    columns: Object.fromEntries(IMPORT_TABLES.map((table) => [table.name, columnsOf(db, table.name).map((column) => column.name)])),
  }
}

/** Lee y comprueba la copia. Lanza ImportRefused si no se puede importar tal cual. */
export function readSourceCopy(path: string): SourceCopy {
  const file = basename(path)
  if (!existsSync(path) || !statSync(path).isFile()) throw new ImportRefused(`No existe la copia «${path}».`)
  const wal = `${path}-wal`
  if (existsSync(wal) && statSync(wal).size > 0) {
    throw new ImportRefused(
      `Junto a la copia hay un «${file}-wal» con cambios que pueden no estar en «${file}». ` +
        'Para la app (Ctrl+C), que al cerrarse los pasa al archivo y borra el -wal, y vuelve a copiar cuentas.db.',
    )
  }
  const bytes = readFileSync(path)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const folder = mkdtempSync(join(tmpdir(), 'cuentas-claras-importar-'))
  try {
    const duplicate = join(folder, 'copia.db')
    copyFileSync(path, duplicate)
    let db: Database.Database
    try {
      db = openSqliteReadOnly(duplicate)
      db.pragma('schema_version')
    } catch (error) {
      throw new ImportRefused(`«${file}» no es una base de datos SQLite (${error instanceof Error ? error.message : String(error)}).`)
    }
    try {
      const { schemaVersion, columns } = check(db, file)
      const rows = Object.fromEntries(
        IMPORT_TABLES.map((table) => {
          const list = columns[table.name].map((column) => `"${column}"`).join(', ')
          const statement = db.prepare(`SELECT ${list} FROM ${table.name}`).safeIntegers(true)
          return [table.name, (statement.all() as Row[]).map(toPlainRow)]
        }),
      )
      return { file, bytes: bytes.length, sha256, schemaVersion, columns, rows }
    } finally {
      db.close()
    }
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}
