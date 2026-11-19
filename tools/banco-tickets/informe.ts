import type { CaseResult } from './comparar.ts'

/**
 * La tabla del banco, en Markdown. Solo lleva recuentos y ✓/✗: sirve igual
 * para los tickets reales, de los que nunca se escribe un nombre, un importe,
 * una fecha ni una dirección fuera de su carpeta.
 */

export interface CaseRow {
  /** «grande/completa» o, para un ticket real, «real-1». */
  name: string
  result: CaseResult | null
  /** Tiempo de preparar en el navegador y de leer (OCR y análisis), en ms. */
  prepareMs: number
  readMs: number
  /** Si no se pudo leer: el mensaje que vería la persona. */
  error?: string
}

const mark = (ok: boolean) => (ok ? '✓' : '✗')
const seconds = (ms: number) => (ms / 1000).toFixed(1)

export const TABLE_HEADER = [
  'Caso', 'Prod.', 'Limpias', 'Bien marc.', 'Mal marc.', '**Mal sin marcar**', 'Faltan', 'Sobran (rep./otras)',
  'IVA', 'Fecha', 'Hora', 'Total', 'Ajustes', 'Estado', 'Preparar s', 'Leer s',
]

export function tableRow({ name, result, prepareMs, readMs, error }: CaseRow): string[] {
  if (!result) return [name, '', '', '', '', '', '', '', '', '', '', '', '', error ?? 'error', seconds(prepareMs), seconds(readMs)]
  const percent = result.products ? Math.round((100 * result.clean) / result.products) : 0
  return [
    name, String(result.products), `${result.clean} (${percent} %)`, String(result.flaggedRight), String(result.flaggedWrong),
    result.silentWrong ? `**${result.silentWrong}**` : '0', String(result.missing), `${result.extraRepeated}/${result.extraOther}`,
    `${result.taxRight}/${result.matched}`, mark(result.date), mark(result.time), mark(result.total), mark(result.adjustments),
    result.status, seconds(prepareMs), seconds(readMs),
  ]
}

export function table(rows: readonly CaseRow[]): string {
  const lines = [TABLE_HEADER, TABLE_HEADER.map(() => '---'), ...rows.map(tableRow)]
  return lines.map((cells) => `| ${cells.join(' | ')} |`).join('\n')
}

/** Totales del banco: lo que dicen los objetivos de un vistazo. */
export function summary(rows: readonly CaseRow[]): string {
  const done = rows.filter((row) => row.result)
  const sum = (key: 'products' | 'clean' | 'silentWrong' | 'missing' | 'extraRepeated' | 'extraOther') =>
    done.reduce((s, row) => s + row.result![key], 0)
  const products = sum('products')
  return [
    `${done.length} de ${rows.length} casos leídos`,
    `${sum('clean')} de ${products} líneas limpias (${products ? Math.round((100 * sum('clean')) / products) : 0} %)`,
    `${sum('silentWrong')} cifras mal sin marcar`,
    `${sum('missing')} productos perdidos`,
    `${sum('extraRepeated') + sum('extraOther')} de sobra`,
    `leer: ${seconds(done.reduce((s, row) => s + row.readMs, 0))} s en total`,
  ].join(' · ')
}
