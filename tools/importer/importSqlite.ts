import { describeDatabase, type DatabaseConfig } from '../../server/common/mysql/config.ts'
import { DatabaseSetupError } from '../../server/common/mysql/errors.ts'
import { openDatabase, type MysqlDatabase, type SqlParam } from '../../server/common/mysql/MysqlDatabase.ts'
import { MysqlUnitOfWork } from '../../server/common/mysql/MysqlUnitOfWork.ts'
import { mappingProblems, rowProblems, targetColumns, type TargetColumn } from './columns.ts'
import { differences, isEqual, snapshot, totals, type TableDifferences, type TableSnapshot, type Totals } from './compare.ts'
import { ImportRefused, readSourceCopy, type SourceCopy } from './source.ts'
import { byCodePoint, IMPORT_TABLES, parentsFirst, type Row } from './tables.ts'

/**
 * El importador SQLite → MySQL (MYSQL-03): pasa una copia de cuentas.db a una
 * base MySQL vacía y demuestra que no se ha perdido ni cambiado nada.
 *
 * 1. Lee y comprueba la copia (source.ts): de Cuentas claras, entera, en la
 *    versión 5 y con sus referencias bien.
 * 2. Prepara el destino con las migraciones de database/mysql/ sin sembrar las
 *    categorías iniciales, y comprueba que las columnas son las mismas y que
 *    cada valor cabe tal cual (columns.ts).
 * 3. En una sola transacción, con los bloqueos de finanzas y tickets: exige
 *    que las doce tablas estén vacías, carga las filas en orden de claves
 *    foráneas (con sus ids, versiones y evidencias, sin repetir los efectos de
 *    los tickets) y vuelve a leerlas. Si alguna fila no coincide, lo deshace
 *    todo.
 * 4. Tras confirmar, lo vuelve a leer con otra conexión y lo compara otra vez.
 *
 * Devuelve el informe; no lanza por los fallos previstos. El DDL de MySQL se
 * confirma solo: si la carga se deshace, la base queda con sus tablas vacías,
 * lista para volver a intentarlo.
 */

export const REPORT_FORMAT = 'cuentas-claras-importacion-v1'
/** Cuántas filas van en cada INSERT. */
const BATCH = 100
/** Cuántos problemas se escriben en el informe (y en la consola, menos). */
const MAX_PROBLEMS = 200

export type ImportResult = 'válido' | 'con diferencias' | 'rechazado'

export interface TableReport {
  origen: { filas: number; huella: string; nulos: Record<string, number> }
  destino: { filas: number; huella: string; nulos: Record<string, number> } | null
  iguales: boolean
  claves: string[]
  diferencias: { faltan: string[]; sobran: string[]; distintas: { clave: string; columnas: string[] }[] } | null
}

export interface ImportReport {
  formato: typeof REPORT_FORMAT
  resultado: ImportResult
  mensaje: string
  fecha: string
  origen: { archivo: string; bytes: number; sha256: string; versionEsquema: number; integridad: 'ok'; referencias: 'ok' } | null
  destino: { base: string; mysql: string | null; versionEsquema: number | null; categoriasSembradas: false } | null
  /** Tablas que se cargaron, en orden. Las tablas técnicas (schema_migrations, app_locks) no se copian. */
  tablas: Record<string, TableReport>
  sumas: { origen: Totals; destino: Totals | null; iguales: boolean } | null
  /** Por qué no se ha importado, con tabla, clave y columna; nunca los valores. */
  problemas: string[]
  problemasSinListar: number
  /** Si la comparación se repitió tras confirmar, con otra conexión, y salió igual. */
  verificadoTrasConfirmar: boolean
}

export interface ImportOptions {
  /** La copia de cuentas.db (la app parada). */
  sourcePath: string
  /** La base de destino (CUENTAS_DB_*): tiene que existir y estar vacía. */
  target: DatabaseConfig
  now?: () => string
  /** Solo para las pruebas: se llama al cargar cada tabla, dentro de la transacción. */
  afterTable?: (table: string, db: MysqlDatabase) => Promise<void>
}

/** Una carga que, al volver a leerla, no coincide con la copia: se deshace. */
class DifferencesFound extends Error {
  readonly snapshots: Record<string, TableSnapshot>

  constructor(snapshots: Record<string, TableSnapshot>) {
    super('Lo cargado no coincide con la copia')
    this.snapshots = snapshots
  }
}

/** Un error de MySQL al cargar, sin su texto (puede llevar un valor de la persona): número, código y tabla. */
function describeLoadError(error: unknown, table: string | null): string {
  const errno = typeof error === 'object' && error !== null ? (error as { errno?: unknown }).errno : undefined
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  const where = table ? ` al cargar «${table}»` : ''
  if (typeof errno === 'number') return `MySQL ha rechazado una fila${where} (${String(code)}, ${errno}).`
  return `La carga ha fallado${where}: ${error instanceof Error ? error.message : String(error)}.`
}

async function readTable(db: MysqlDatabase, table: string, columns: readonly TargetColumn[]): Promise<Row[]> {
  return db.rows<Row>(`SELECT ${columns.map((c) => `\`${c.name}\``).join(', ')} FROM ${table}`)
}

async function snapshotsOf(db: MysqlDatabase, columns: Record<string, TargetColumn[]>): Promise<Record<string, TableSnapshot>> {
  const result: Record<string, TableSnapshot> = {}
  for (const table of IMPORT_TABLES) result[table.name] = snapshot(table, columns[table.name], await readTable(db, table.name, columns[table.name]))
  return result
}

async function insertRows(db: MysqlDatabase, table: string, columns: readonly TargetColumn[], rows: readonly Row[]): Promise<void> {
  const names = columns.map((c) => `\`${c.name}\``).join(', ')
  const tuple = `(${columns.map(() => '?').join(', ')})`
  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH)
    const params = batch.flatMap((row) => columns.map((c) => row[c.name] as SqlParam))
    await db.run(`INSERT INTO ${table} (${names}) VALUES ${batch.map(() => tuple).join(', ')}`, params)
  }
}

function tableReports(source: Record<string, TableSnapshot>, target: Record<string, TableSnapshot> | null): Record<string, TableReport> {
  return Object.fromEntries(
    IMPORT_TABLES.map((table) => {
      const from = source[table.name]
      const to = target?.[table.name] ?? null
      const diff: TableDifferences | null = to ? differences(from, to) : null
      return [
        table.name,
        {
          origen: { filas: from.rows, huella: from.hash, nulos: from.nulls },
          destino: to ? { filas: to.rows, huella: to.hash, nulos: to.nulls } : null,
          iguales: diff !== null && isEqual(diff) && from.hash === to?.hash,
          claves: [...from.byKey.keys()].sort(byCodePoint),
          diferencias: diff ? { faltan: diff.missing, sobran: diff.extra, distintas: diff.changed.map(({ key, columns }) => ({ clave: key, columnas: columns })) } : null,
        },
      ]
    }),
  )
}

export async function importSqlite({ sourcePath, target, now = () => new Date().toISOString(), afterTable }: ImportOptions): Promise<ImportReport> {
  const report: ImportReport = {
    formato: REPORT_FORMAT,
    resultado: 'rechazado',
    mensaje: '',
    fecha: now(),
    origen: null,
    destino: null,
    tablas: {},
    sumas: null,
    problemas: [],
    problemasSinListar: 0,
    verificadoTrasConfirmar: false,
  }
  const refuse = (message: string, problems: readonly string[] = []) => {
    report.resultado = 'rechazado'
    report.mensaje = message
    report.problemas = problems.slice(0, MAX_PROBLEMS)
    report.problemasSinListar = Math.max(0, problems.length - MAX_PROBLEMS)
    return report
  }

  let source: SourceCopy
  try {
    source = readSourceCopy(sourcePath)
  } catch (error) {
    if (error instanceof ImportRefused) return refuse(error.message, error.problems)
    throw error
  }
  report.origen = { archivo: source.file, bytes: source.bytes, sha256: source.sha256, versionEsquema: source.schemaVersion, integridad: 'ok', referencias: 'ok' }
  report.destino = { base: describeDatabase(target), mysql: null, versionEsquema: null, categoriasSembradas: false }

  let db: MysqlDatabase
  try {
    // Sin sembrar: las categorías son las de la copia, nunca las iniciales.
    const opened = await openDatabase(target, { seedNewDatabase: false })
    db = opened.db
    report.destino.versionEsquema = opened.schemaVersion
  } catch (error) {
    if (error instanceof DatabaseSetupError) return refuse(error.message)
    throw error
  }

  try {
    report.destino.mysql = (await db.rows<{ version: string }>('SELECT VERSION() AS version'))[0]?.version ?? null
    const columns = await targetColumns(db)
    const mapping = mappingProblems(source.columns, columns)
    if (mapping.length > 0) return refuse('Las tablas de la copia y las de MySQL no tienen las mismas columnas: el importador no sabe pasarlas.', mapping)
    const problems = rowProblems(source.rows, columns)
    if (problems.length > 0) {
      return refuse(
        `Hay ${problems.length} ${problems.length === 1 ? 'valor que no cabría' : 'valores que no cabrían'} tal cual en MySQL, así que no se ha importado nada. ` +
          'Corrígelos en la app con SQLite (o dile a quien te ayude qué filas son) y vuelve a copiar cuentas.db.',
        problems,
      )
    }

    const sourceSnapshots = Object.fromEntries(IMPORT_TABLES.map((table) => [table.name, snapshot(table, columns[table.name], source.rows[table.name])]))
    const unitOfWork = new MysqlUnitOfWork(db)
    let loading: string | null = null
    try {
      const loaded = await unitOfWork.run(
        () =>
          unitOfWork.run(
            async () => {
              // Las doce tablas vacías: los datos de la copia no se mezclan con otros (las técnicas no cuentan).
              const used: string[] = []
              for (const table of IMPORT_TABLES) {
                const [{ n }] = await db.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table.name}`)
                if (n > 0) used.push(`${table.name}: ${n} ${n === 1 ? 'fila' : 'filas'}`)
              }
              if (used.length > 0) {
                throw new ImportRefused(
                  `La base «${target.database}» no está vacía, así que no se ha importado nada: el importador no mezcla datos. ` +
                    'Si arrancaste la app con ella (crea las categorías iniciales), bórrala y créala vacía otra vez (README, «Pasar los datos de SQLite a MySQL»).',
                  used,
                )
              }
              for (const table of IMPORT_TABLES) {
                loading = table.name
                const rows = table.name === 'categories' ? parentsFirst(source.rows[table.name]) : source.rows[table.name]
                await insertRows(db, table.name, columns[table.name], rows)
                await afterTable?.(table.name, db)
              }
              loading = null
              const snapshots = await snapshotsOf(db, columns)
              if (IMPORT_TABLES.some((table) => !isEqual(differences(sourceSnapshots[table.name], snapshots[table.name])))) throw new DifferencesFound(snapshots)
              return snapshots
            },
            { lock: 'tickets' },
          ),
        { lock: 'finance' },
      )
      report.tablas = tableReports(sourceSnapshots, loaded)
      report.sumas = { origen: totals(sourceSnapshots), destino: totals(loaded), iguales: JSON.stringify(totals(sourceSnapshots)) === JSON.stringify(totals(loaded)) }
    } catch (error) {
      if (error instanceof ImportRefused) return refuse(error.message, error.problems)
      if (error instanceof DifferencesFound) {
        report.tablas = tableReports(sourceSnapshots, error.snapshots)
        report.sumas = { origen: totals(sourceSnapshots), destino: totals(error.snapshots), iguales: false }
        report.resultado = 'con diferencias'
        report.mensaje = 'Lo cargado no coincide fila a fila con la copia, así que se ha deshecho: la base queda vacía. Mira las diferencias de cada tabla en el informe.'
        return report
      }
      report.tablas = tableReports(sourceSnapshots, null)
      return refuse(`${describeLoadError(error, loading)} Se ha deshecho todo: la base queda vacía.`)
    }

    // Confirmado: otra lectura, ya fuera de la transacción, con el pool.
    const committed = await snapshotsOf(db, columns)
    report.verificadoTrasConfirmar = IMPORT_TABLES.every((table) => isEqual(differences(sourceSnapshots[table.name], committed[table.name])))
    if (!report.verificadoTrasConfirmar) {
      report.tablas = tableReports(sourceSnapshots, committed)
      report.resultado = 'con diferencias'
      report.mensaje = `Lo confirmado en «${target.database}» no coincide con la copia al volver a leerlo. No arranques la app con esta base: bórrala, créala vacía y repite la importación.`
      return report
    }
    const rows = IMPORT_TABLES.reduce((sum, table) => sum + source.rows[table.name].length, 0)
    report.resultado = 'válido'
    report.mensaje = `Importadas ${rows} filas de ${IMPORT_TABLES.length} tablas en «${target.database}»: todas coinciden fila a fila con la copia.`
    return report
  } finally {
    await db.close().catch(() => {})
  }
}
