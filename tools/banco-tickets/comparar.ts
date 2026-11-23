import { similarity } from '#shared/tickets/ticketText.ts'
import type { ParsedTicket, ParsedTicketLine } from '#shared/tickets/ticketParse.ts'
import type { Verdad, VerdadLinea } from './verdad.ts'

/**
 * Compara lo que lee la app (parseTicket) con la verdad de un ticket. Lo que
 * importa no es cuántas líneas salen limpias, sino que ninguna cifra mal leída
 * pase sin marcar.
 *
 * Las líneas se emparejan en orden, con programación dinámica sobre el
 * parecido del nombre (y el importe, si coincide): así los productos repetidos
 * se emparejan uno a uno y una línea perdida no descoloca las demás. Cada línea
 * de la verdad acaba en una clase:
 * - limpia: bien leída y sin marcar;
 * - bien-marcada: bien leída, pero la revisión la enseña como dudosa;
 * - mal-marcada: alguna cifra mal, y marcada;
 * - mal-sin-marcar: alguna cifra mal y nada lo avisa (el fallo que no puede pasar);
 * - falta: no aparece.
 * «Mal» es un importe, cantidad, precio unitario, peso, precio por kilo o
 * descuento distinto. Las líneas leídas sin pareja «sobran»: repetidas (se
 * parecen a un producto del ticket) o que no son productos; si además no van
 * marcadas, cuentan también como «mal sin marcar».
 *
 * Una PROMO de la verdad (un ajuste) vale igual como ajuste o como descuento de
 * una sola línea: la de debajo de la que va, si la verdad lo sabe.
 */

export type LineClass = 'limpia' | 'bien-marcada' | 'mal-marcada' | 'mal-sin-marcar' | 'falta'

export interface LineComparison {
  truth: number | null
  read: number | null
  class: LineClass | 'sobra-repetida' | 'sobra-no-producto'
  /** Campos distintos de la verdad: «importe 3,95 ≠ 7,90». */
  differences: string[]
  flags: string[]
  issues: string[]
}

export interface CaseResult {
  products: number
  clean: number
  flaggedRight: number
  flaggedWrong: number
  silentWrong: number
  missing: number
  extraRepeated: number
  extraOther: number
  /** Líneas emparejadas con la letra del IVA bien, y cuántas hay emparejadas. */
  taxRight: number
  matched: number
  date: boolean
  time: boolean
  total: boolean
  adjustments: boolean
  status: string
  lines: LineComparison[]
  issues: string[]
}

const euros = (cents: number | null) => (cents === null ? '—' : `${(cents / 100).toFixed(2).replace('.', ',')}`)

/** Puntuación de emparejar una línea de la verdad con una leída; 0 si no se parecen. */
function matchScore(truth: VerdadLinea, read: ParsedTicketLine): number {
  const name = similarity(truth.rawName, read.rawName)
  const sameAmount = read.amountCents !== null && read.amountCents === truth.amountCents
  if (name < 0.5 && !(sameAmount && name >= 0.3)) return 0
  return name + (sameAmount ? 0.5 : 0)
}

/** Pares (verdad, leída) en orden, maximizando el parecido total. */
export function align(truth: readonly VerdadLinea[], read: readonly ParsedTicketLine[]): [number, number][] {
  const n = truth.length
  const m = read.length
  const best = Array.from({ length: n + 1 }, () => new Float64Array(m + 1))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const score = matchScore(truth[i - 1], read[j - 1])
      best[i][j] = Math.max(best[i - 1][j], best[i][j - 1], score > 0 ? best[i - 1][j - 1] + score : 0)
    }
  }
  const pairs: [number, number][] = []
  for (let i = n, j = m; i > 0 && j > 0;) {
    const score = matchScore(truth[i - 1], read[j - 1])
    if (score > 0 && best[i][j] === best[i - 1][j - 1] + score) { pairs.push([i - 1, j - 1]); i--; j-- }
    else if (best[i][j] === best[i - 1][j]) i--
    else j--
  }
  return pairs.reverse()
}

function differences(truth: VerdadLinea, read: ParsedTicketLine, discountCents: number): string[] {
  const out: string[] = []
  if (read.amountCents !== truth.amountCents) out.push(`importe ${euros(read.amountCents)} ≠ ${euros(truth.amountCents)}`)
  if (read.quantity !== truth.quantity) out.push(`cantidad ${read.quantity} ≠ ${truth.quantity}`)
  if ((read.unitPriceCents ?? null) !== truth.unitPriceCents) out.push(`precio ${euros(read.unitPriceCents)} ≠ ${euros(truth.unitPriceCents)}`)
  const grams = (kg: number | null) => (kg === null ? null : Math.round(kg * 1000))
  if (grams(read.weightKg) !== grams(truth.weightKg)) out.push(`peso ${read.weightKg ?? '—'} ≠ ${truth.weightKg ?? '—'}`)
  if ((read.pricePerKgCents ?? null) !== truth.pricePerKgCents) out.push(`precio por kilo ${euros(read.pricePerKgCents)} ≠ ${euros(truth.pricePerKgCents)}`)
  if (read.discountCents !== discountCents) out.push(`descuento ${euros(read.discountCents)} ≠ ${euros(discountCents)}`)
  return out
}

export function compareTicket(truth: Verdad, ticket: ParsedTicket): CaseResult {
  const pairs = align(truth.lines, ticket.lines)
  const readOf = new Map(pairs.map(([t, r]) => [t, r]))
  const matchedRead = new Set(pairs.map(([, r]) => r))

  // Las PROMO de la verdad: como ajuste o como descuento de más en una línea.
  const expectedDiscount = truth.lines.map((line) => line.discountCents)
  let adjustmentsOk = true
  const readAdjustments = [...ticket.adjustments]
  for (const promo of truth.adjustments) {
    const asAdjustment = readAdjustments.findIndex((a) => a.amountCents === promo.amountCents)
    if (asAdjustment >= 0) { readAdjustments.splice(asAdjustment, 1); continue }
    const candidates = promo.line !== undefined ? [promo.line] : truth.lines.map((_, i) => i)
    const target = candidates.find((t) => {
      const r = readOf.get(t)
      return r !== undefined && ticket.lines[r].discountCents === expectedDiscount[t] - promo.amountCents
    })
    if (target === undefined) adjustmentsOk = false
    else expectedDiscount[target] -= promo.amountCents
  }
  if (readAdjustments.some((a) => a.amountCents !== 0)) adjustmentsOk = false

  const lines: LineComparison[] = []
  const result: CaseResult = {
    products: truth.lines.length, clean: 0, flaggedRight: 0, flaggedWrong: 0, silentWrong: 0, missing: 0, extraRepeated: 0, extraOther: 0,
    taxRight: 0, matched: pairs.length,
    date: ticket.date === truth.date, time: ticket.time === truth.time, total: ticket.totalCents === truth.totalCents,
    adjustments: adjustmentsOk, status: ticket.check.status, lines, issues: ticket.issues,
  }
  truth.lines.forEach((line, t) => {
    const r = readOf.get(t)
    if (r === undefined) {
      result.missing++
      lines.push({ truth: t, read: null, class: 'falta', differences: [], flags: [], issues: [] })
      return
    }
    const read = ticket.lines[r]
    const diff = differences(line, read, expectedDiscount[t])
    const flagged = read.flags.length > 0
    const kind: LineClass = diff.length === 0 ? (flagged ? 'bien-marcada' : 'limpia') : (flagged ? 'mal-marcada' : 'mal-sin-marcar')
    if (kind === 'limpia') result.clean++
    else if (kind === 'bien-marcada') result.flaggedRight++
    else if (kind === 'mal-marcada') result.flaggedWrong++
    else result.silentWrong++
    if (read.taxCode === line.taxCode) result.taxRight++
    lines.push({ truth: t, read: r, class: kind, differences: diff, flags: read.flags, issues: read.evidence?.issues ?? [] })
  })
  ticket.lines.forEach((read, r) => {
    if (matchedRead.has(r)) return
    const repeated = truth.lines.some((line) => similarity(line.rawName, read.rawName) >= 0.8)
    if (repeated) result.extraRepeated++
    else result.extraOther++
    // Una línea de más sin marcar también es un error que pasaría sin avisar: se guardaría una compra que no existe.
    if (read.flags.length === 0) result.silentWrong++
    lines.push({ truth: null, read: r, class: repeated ? 'sobra-repetida' : 'sobra-no-producto', differences: [], flags: read.flags, issues: read.evidence?.issues ?? [] })
  })
  return result
}
