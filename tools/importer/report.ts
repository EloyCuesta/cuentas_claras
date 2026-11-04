import { writeFileSync } from 'node:fs'
import type { ImportReport } from './importSqlite.ts'

/**
 * El informe de una importación: el JSON completo en un archivo y unas líneas
 * para la consola. En la consola solo salen recuentos, el resultado y dónde
 * está el informe: ni conceptos, ni nombres, ni importes.
 */

/** 0: importado y comprobado; 1: con diferencias (se deshizo); 2: rechazado o fallido (no se importó nada). */
export function exitCode(report: ImportReport): 0 | 1 | 2 {
  if (report.resultado === 'válido') return 0
  return report.resultado === 'con diferencias' ? 1 : 2
}

export function writeReport(report: ImportReport, path: string): void {
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

/** Nombre del informe por defecto: informe-importacion-AAAAMMDD-HHMMSS.json (en hora UTC). */
export function defaultReportName(isoDate: string): string {
  const stamp = isoDate.slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
  return `informe-importacion-${stamp}.json`
}

/** Lo que se escribe en la consola. */
export function summaryLines(report: ImportReport, reportPath: string | null): string[] {
  const lines: string[] = []
  if (report.origen) {
    lines.push(
      `Copia: ${report.origen.archivo} (${report.origen.bytes} bytes, SHA-256 ${report.origen.sha256.slice(0, 16)}…), esquema SQLite ${report.origen.versionEsquema}, integridad y referencias correctas.`,
    )
  }
  if (report.destino) {
    lines.push(`Destino: ${report.destino.base}${report.destino.mysql ? ` (MySQL ${report.destino.mysql})` : ''}, sin categorías sembradas.`)
  }
  const tables = Object.entries(report.tablas)
  if (tables.length > 0) {
    lines.push(
      `Filas: ${tables.map(([name, table]) => `${name} ${table.origen.filas}${table.destino && !table.iguales ? ` (en MySQL ${table.destino.filas}, distinta)` : ''}`).join(' · ')}.`,
    )
  }
  for (const problem of report.problemas.slice(0, 20)) lines.push(`  - ${problem}`)
  const hidden = report.problemas.length - Math.min(report.problemas.length, 20) + report.problemasSinListar
  if (hidden > 0) lines.push(`  … y ${hidden} más${reportPath ? ' (en el informe)' : ''}.`)
  lines.push(`Resultado: ${report.resultado}. ${report.mensaje}`)
  if (reportPath) lines.push(`Informe: ${reportPath}`)
  return lines
}
