import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { parseTicket, type ParsedTicket } from '#shared/tickets/ticketParse.ts'
import { createTesseractReader } from '../../server/modules/tickets/index.ts'
import { compareTicket } from './comparar.ts'
import { summary, table, type CaseRow } from './informe.ts'
import { abrirNavegador } from './navegador.ts'
import { FIXTURES_DIR, IMAGES_DIR, PRIVATE_DIR, RESULTS_DIR } from './rutas.ts'
import type { ImagenBanco } from './tipos.ts'
import type { Verdad } from './verdad.ts'

/**
 * `npm run medir:tickets`: pasa cada caso por el mismo camino que la app
 * (preparar las imágenes en Chrome con ticketImages.ts, leerlas con el lector
 * real de Tesseract y analizarlas con parseTicket, como ReadTicket), lo compara
 * con su verdad y da una tabla por caso.
 *
 * Casos:
 * - los sintéticos: cada variante de .banco-tickets/imagenes/<ticket>/ (las crea
 *   `npm run generar:tickets`) con su verdad de fixtures/tickets/banco/;
 * - los reales, si existe su carpeta (CUENTAS_TICKETS_PRIVADOS, por defecto
 *   C:\tickets-privados): cada <nombre>.json con su imagen <nombre>.png/.jpg o
 *   una carpeta <nombre>/ con las capturas en orden. Salen como «real-1…» y su
 *   detalle se escribe solo dentro de esa carpeta.
 *
 * Opciones: --caso <texto> (solo los casos que lo contienen), --solo-sinteticos,
 * --guardar <archivo.md> (escribe la tabla).
 */

interface Case {
  name: string
  real: boolean
  truth: Verdad
  images: string[]
}

const IMAGE = /\.(png|jpe?g)$/i
const mime = (file: string) => (/\.png$/i.test(file) ? 'image/png' : 'image/jpeg')
const readJson = <T>(file: string) => JSON.parse(readFileSync(file, 'utf8')) as T

function syntheticCases(): Case[] {
  if (!existsSync(IMAGES_DIR)) throw new Error('No hay imágenes sintéticas: genéralas antes con npm run generar:tickets')
  const cases: Case[] = []
  for (const ticket of readdirSync(IMAGES_DIR).sort()) {
    const truth = readJson<Verdad>(`${FIXTURES_DIR}${ticket}.json`)
    for (const variant of readdirSync(`${IMAGES_DIR}${ticket}`).sort()) {
      const dir = `${IMAGES_DIR}${ticket}/${variant}/`
      cases.push({ name: `${ticket}/${variant}`, real: false, truth, images: readdirSync(dir).filter((f) => IMAGE.test(f)).sort().map((f) => dir + f) })
    }
  }
  return cases
}

function realCases(): Case[] {
  if (!existsSync(PRIVATE_DIR)) return []
  const files = readdirSync(PRIVATE_DIR)
  const cases: Case[] = []
  for (const file of files.filter((f) => extname(f).toLowerCase() === '.json').sort()) {
    const stem = basename(file, extname(file))
    const folder = join(PRIVATE_DIR, stem)
    const images = existsSync(folder) && statSync(folder).isDirectory()
      ? readdirSync(folder).filter((f) => IMAGE.test(f)).sort().map((f) => join(folder, f))
      : files.filter((f) => IMAGE.test(f) && basename(f, extname(f)) === stem).map((f) => join(PRIVATE_DIR, f))
    if (images.length === 0) continue
    cases.push({ name: `real-${cases.length + 1}`, real: true, truth: readJson<Verdad>(join(PRIVATE_DIR, file)), images })
  }
  return cases
}

function option(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

/** El detalle de un caso: cada línea con su clase. El de un caso real solo se escribe en su carpeta. */
function writeDetail(stamp: string, caso: Case, ticket: ParsedTicket | null, row: CaseRow, warnings: string[]) {
  const dir = caso.real ? join(PRIVATE_DIR, 'resultados', stamp) : `${RESULTS_DIR}${stamp}/`
  mkdirSync(dir, { recursive: true })
  const detail = {
    caso: caso.name,
    imagenes: caso.images.map((f) => basename(f)),
    avisosDelNavegador: warnings,
    resultado: row.result && { ...row.result, lines: undefined },
    lineas: row.result?.lines.map((line) => ({
      ...line,
      verdad: line.truth === null ? null : caso.truth.lines[line.truth],
      leida: line.read === null || !ticket ? null : ticket.lines[line.read],
    })),
    ajustes: ticket?.adjustments,
    error: row.error,
  }
  writeFileSync(join(dir, `${caso.name.replace(/\//g, '--')}.json`), `${JSON.stringify(detail, null, 1)}\n`)
}

async function main() {
  const only = option('--caso')
  const save = option('--guardar')
  const cases = [...syntheticCases(), ...(process.argv.includes('--solo-sinteticos') ? [] : realCases())]
    .filter((c) => !only || c.name.includes(only))
  if (cases.length === 0) throw new Error('No hay casos que medir')
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
  const navegador = await abrirNavegador()
  const reader = createTesseractReader({ idleMs: 60_000 })
  const rows: CaseRow[] = []
  try {
    // Abrir el lector la primera vez tarda: no se cuenta en ningún caso.
    await reader.read([readFileSync(`${FIXTURES_DIR}../ticket-lidl-ejemplo.png`)])
    for (const caso of cases) {
      const images: ImagenBanco[] = caso.images.map((file) => ({ nombre: basename(file), tipo: mime(file), base64: readFileSync(file).toString('base64') }))
      const prepared = await navegador.preparar(images)
      let row: CaseRow
      let ticket: ParsedTicket | null = null
      if (prepared.error) row = { name: caso.name, result: null, prepareMs: prepared.ms, readMs: 0, error: prepared.error }
      else {
        const start = performance.now()
        const pages = await reader.read(
          prepared.franjas.map((f) => Buffer.from(f.image, 'base64')),
          prepared.franjas.map(({ image: _image, ...segment }) => segment),
        )
        ticket = parseTicket(pages)
        row = { name: caso.name, result: compareTicket(caso.truth, ticket), prepareMs: prepared.ms, readMs: performance.now() - start }
      }
      rows.push(row)
      writeDetail(stamp, caso, ticket, row, prepared.avisos)
      console.log(`${caso.name}: ${row.result ? `${row.result.clean}/${row.result.products} limpias, ${row.result.silentWrong} mal sin marcar` : row.error}`)
    }
  } finally {
    await reader.close()
    await navegador.cerrar()
  }
  const text = `${table(rows)}\n\n${summary(rows)}\n`
  console.log(`\n${text}`)
  console.log(`Detalle: ${RESULTS_DIR}${stamp}/${rows.some((r) => r.name.startsWith('real-')) ? ' (los reales, en su carpeta)' : ''}`)
  if (save) writeFileSync(save, text)
}

await main()
