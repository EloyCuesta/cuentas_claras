import { accessSync, constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { readDatabaseConfig } from '../../server/common/mysql/config.ts'
import { importSqlite } from './importSqlite.ts'
import { defaultReportName, exitCode, summaryLines, writeReport } from './report.ts'

/**
 * npm run importar:sqlite -- <copia de cuentas.db> [--informe <archivo.json>]
 *
 * Pasa una copia de cuentas.db (la de la app con SQLite, con la app parada) a
 * la base MySQL de CUENTAS_DB_* (por defecto cuentas_claras), que tiene que
 * existir y estar vacía. Escribe el informe junto a la copia, salvo que se
 * indique otro sitio. Sale con 0 si todo coincide, 1 si hay diferencias (se
 * deshace la carga), 2 si no se ha podido importar (no se ha escrito nada) y 3
 * si se importó y comprobó pero el informe no se pudo escribir. Lee .env como
 * el servidor; no necesita CUENTAS_CODIGO.
 */

const USAGE = 'Uso: npm run importar:sqlite -- <copia de cuentas.db> [--informe <archivo.json>]'

function fail(message: string): never {
  console.error(`[importar] ${message}`)
  process.exit(2)
}

function readArguments(): { source: string; report: string | undefined } {
  let values: { informe?: string }
  let positionals: string[]
  try {
    ;({ values, positionals } = parseArgs({ options: { informe: { type: 'string' } }, allowPositionals: true }))
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`)
  }
  if (positionals.length !== 1) fail(USAGE)
  return { source: positionals[0], report: values.informe }
}

const args = readArguments()
const config = readDatabaseConfig(process.env)
if (!config.ok) fail(config.message)

const sourcePath = resolve(args.source)
const fecha = new Date().toISOString()
const reportPath = resolve(args.report ?? join(dirname(sourcePath), defaultReportName(fecha)))
try {
  accessSync(dirname(reportPath), constants.W_OK)
} catch {
  fail(`No se puede escribir el informe en ${dirname(reportPath)}: elige otra carpeta con --informe.`)
}

console.log(`[importar] Importando ${sourcePath} en MySQL…`)
const report = await importSqlite({ sourcePath, target: config.config, now: () => fecha })
let written: string | null = null
try {
  writeReport(report, reportPath)
  written = reportPath
} catch (error) {
  console.error(`[importar] No se ha podido escribir el informe en ${reportPath}: ${error instanceof Error ? error.message : String(error)}`)
}
for (const line of summaryLines(report, written)) console.log(`[importar] ${line}`)
process.exit(written === null && report.resultado === 'válido' ? 3 : exitCode(report))
