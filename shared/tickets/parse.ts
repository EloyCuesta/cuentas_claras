import { formatEuros } from '../core/money.ts'
import { readTail } from './parse/amounts.ts'
import {
  cleanText,
  DISCOUNT_LINE,
  endsProducts,
  HEADER_WORDS,
  isSeparator,
  letterCount,
  PROMOTIONAL_LINE,
  tokensOf,
  TOTAL_LINE,
} from './parse/clean.ts'
import { checkTaxGroups, checkTicket, paymentMethodOf, readTaxGroups } from './parse/footer.ts'
import { addressOf, dateAndTime, detectStore, storeNameOf } from './parse/header.ts'
import { addCandidate, readDiscount, readItemLine, readWeight, type WorkLine } from './parse/lines.ts'
import { mergePages } from './parse/pages.ts'
import { selectLine, sorted } from './parse/select.ts'
import { readTotal } from './parse/total.ts'
import type { ParsedTicket } from './parse/types.ts'
import { nameKey } from './text.ts'
import type { OcrLine, TicketAdjustment } from './types.ts'

export {
  type TicketStore,
  type TaxCode,
  type TicketLineFlag,
  type ParsedTicketLine,
  type TicketCheckStatus,
  type TicketCheck,
  type ParsedTicket,
  type TicketTaxGroup,
  type TaxGroupCheck,
} from './parse/types.ts'
export { PAYMENT_LINE, FISCAL_LINE, PROMOTIONAL_LINE, endsProducts } from './parse/clean.ts'
export { mergePages, linesFromText } from './parse/pages.ts'
export { readTaxGroups, checkTaxGroups, checkTicket, CHECK_LABELS } from './parse/footer.ts'

/**
 * Analizador de tickets de la compra: convierte las líneas leídas por el OCR
 * (o el texto pegado por el usuario) en tienda, fecha, total y productos.
 *
 * Está pensado para el ticket de Lidl (app Lidl Plus o papel), con un modo
 * genérico para otras tiendas. Cada línea puede venir con dos lecturas (la
 * normal y la de solo cifras, ver server/tickets/ocr.ts). El importe de cada producto
 * se elige entre los candidatos leídos y los que se pueden calcular
 * (cantidad × precio, peso × precio por kilo), comprobando que la suma cuadre
 * con el TOTAL del ticket. Lo que no se puede asegurar se marca para revisar.
 *
 * Funciones puras, sin dependencias del OCR, de React ni del reloj. Cada paso
 * está en parse/ (importes, limpieza, páginas, cabecera, líneas, selección,
 * total y pie); aquí está el recorrido completo y lo que se usa desde fuera.
 */

/** Analiza las líneas leídas de una o varias capturas (o el texto pegado, una línea por renglón). */
export function parseTicket(pages: readonly (readonly OcrLine[])[]): ParsedTicket {
  const lines = mergePages(pages).filter(line => line.text.trim() !== '')
  const store = detectStore(lines)
  const issues: string[] = []
  const adjustments: TicketAdjustment[] = []
  const work: WorkLine[] = []
  let state: 'header' | 'products' | 'adjustments' | 'closed' = 'header'
  let previousWasItem = false
  let totalIndex: number | null = null
  let promoIndex = lines.length
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (PROMOTIONAL_LINE.test(line.text) && state !== 'header') promoIndex = Math.min(promoIndex, i)
    if (TOTAL_LINE.test(line.text) && state !== 'header' && totalIndex === null && i < promoIndex) {
      totalIndex = i
      state = 'closed'
    }
    if (state === 'closed') continue
    if (endsProducts(line.text)) {
      if (state !== 'header') state = 'closed'
      continue
    }
    if (/^\s*EUR\s*$/i.test(line.text)) { state = 'products'; continue }
    if (HEADER_WORDS.test(line.text) || isSeparator(line.text)) continue
    if (state === 'header') {
      // Sin la cabecera «EUR», el primer producto es la primera línea con nombre e importe. El
      // importe vale de cualquiera de las dos lecturas: si la normal sale deformada («1,7298»)
      // y solo se mirara esa, el primer producto se perdería como si fuera cabecera.
      const tail = readTail(tokensOf(cleanText(line.text)))
      const rereadAmount = line.reread ? readTail(tokensOf(cleanText(line.reread))).amount : null
      const looksLikeAmount = tail.amount !== null || (rereadAmount !== null && /\d[,.:;]?\d/.test(tail.nameTokens.at(-1) ?? ''))
      if (!looksLikeAmount || letterCount(tail.nameTokens.join(' ')) < 2 || DISCOUNT_LINE.test(line.text) || TOTAL_LINE.test(line.text)) continue
      state = 'products'
    }
    const previous = work[work.length - 1]
    const weight = readWeight(line)
    if (weight && /^\s*\d/.test(line.text)) {
      if (previous && previousWasItem && previous.weightKg === null) {
        previous.weightKg = weight.weightKg
        previous.pricePerKgCents = weight.pricePerKgCents
        previous.inputsStable = weight.agreed
        previous.confidence = { amount: previous.confidence.amount, inputs: weight.confidence }
      } else issues.push('Línea de peso sin producto identificable')
      continue
    }
    if (DISCOUNT_LINE.test(line.text)) {
      if (/^\s*(ahorro|ahorrado|resumen)\b/i.test(line.text)) { previousWasItem = false; continue }
      const discount = readDiscount(line)
      // A short Desc./Dto. continuation is the supported article-discount
      // grammar. A named coupon/promotion is never assigned by proximity.
      if (/^\s*(desc[.,]?|dto[.,]?|descuento art[ií]culo)\s+-/i.test(cleanText(line.text)) && previous && previousWasItem) {
        previous.discounts.push(discount)
      } else {
        const kind = /cup[oó]n/i.test(line.text) ? 'coupon' : /promo/i.test(line.text) ? 'promotion' : 'discount'
        adjustments.push({ id: `adjustment-${i}`, label: line.text.trim().slice(0, 120), kind,
          amountCents: discount.length ? -sorted(discount)[0].cents : null,
          needsReview: true, originalText: line.text })
        state = 'adjustments'
      }
      previousWasItem = false
      continue
    }
    if (work.length >= 300) { issues.push('El ticket supera las 300 líneas; lectura incompleta'); state = 'closed'; continue }
    const item = readItemLine(line, work.length)
    if (item) {
      work.push(item)
      previousWasItem = true
      state = 'products'
      continue
    }
    const tail = readTail(tokensOf(cleanText(line.text)))
    if (previous && previousWasItem && previous.amount.length === 0 && tail.amount) addCandidate(previous.amount, tail.amount.cents, 1)
    else previousWasItem = false
  }
  const metadata = lines.slice(0, promoIndex)
  const totalCents = readTotal(metadata, totalIndex)
  if (totalIndex === null) issues.push(totalCents === null ? 'No se ha encontrado el total' : 'Total obtenido del pago: confirma que es el importe completo')
  if (state !== 'closed') issues.push('No se ha identificado el final del ticket; podría estar recortado')
  const parsed = work.map(selectLine)
  // Si se dejó de leer por tamaño faltan líneas: la suma no demuestra nada aunque haya total.
  const check = checkTicket(parsed.map(l => ({ ...l, pending: l.flags.length > 0 })), totalCents, adjustments, { incomplete: work.length >= 300 })
  if (check.status === 'no_cuadra') issues.push('Los importes no cuadran con el total')
  if (check.status === 'pendiente') issues.push('La suma coincide con el total, pero hay líneas dudosas: dos errores pueden compensarse')
  for (let p = 1; p < pages.length; p++) {
    const previous = pages[p - 1]
    const next = pages[p]
    if (previous.length && next.length && !next[0].source && nameKey(previous.at(-1)!.text) === nameKey(next[0].text)) {
      if (nameKey(next[0].text) === nameKey(next[1]?.text ?? '')) issues.push('Solapamiento ambiguo: se han conservado los productos repetidos')
    }
  }
  const taxGroups = readTaxGroups(metadata.slice(totalIndex ?? 0))
  const taxCheck = checkTaxGroups(parsed, taxGroups, adjustments)
  for (const group of taxCheck.groups) {
    if (taxCheck.conclusive && group.differenceCents !== null && group.differenceCents !== 0) {
      issues.push(`El desglose de IVA ${group.code} suma ${formatEuros(group.grossCents)} y sus artículos ${formatEuros(group.linesCents!)}: alguno de esos importes puede estar mal leído`)
    }
  }
  if (check.status === 'cuadra' && taxCheck.mismatches > 0) check.status = 'pendiente'
  const confidences = work.map(w => w.source.confidence).filter((c): c is number => typeof c === 'number')
  if (confidences.length >= 3 && confidences.filter(c => c < 60).length / confidences.length >= 0.3) {
    issues.push('Muchas líneas se leen con poca nitidez: la imagen puede tener poca resolución. Prueba con la captura original o una foto más cercana')
  }
  const paymentTotals = metadata.filter(l => /^\s*(Lidl\s*Pay|IMPORTE:|TOTAL\b)/i.test(l.text))
    .map(l => readTotal([l], /^\s*TOTAL\b/i.test(l.text) ? 0 : null)).filter(n => n !== null)
  if (new Set(paymentTotals).size > 1) issues.push('Los totales de compra y pago no coinciden')
  const { date, time } = dateAndTime(metadata)
  if (!date) issues.push('No se ha reconocido la fecha de compra')
  return { store, storeName: storeNameOf(store, lines), address: addressOf(store, lines), date, time,
    totalCents, lines: parsed, adjustments, issues: [...new Set(issues)], check, taxGroups,
    paymentMethod: paymentMethodOf(metadata.slice(totalIndex ?? 0)) }
}
