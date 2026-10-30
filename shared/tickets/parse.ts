import { isValidISODate, toISODate } from '../core/dates.ts'
import { formatEuros } from '../core/money.ts'
import type { ISODate } from '../core/types.ts'
import { roundRatio } from './arithmetic.ts'
import { assessUnits, assessWeight, printedDigits, type AmountReading } from './evidence.ts'
import { nameKey, similarity } from './text.ts'
import type { OcrLine, TicketAdjustment, TicketAmountOption, TicketDiscrepancy, TicketEvidence } from './types.ts'

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
 * Funciones puras, sin dependencias del OCR, de React ni del reloj.
 */

export type TicketStore = 'lidl' | 'otra'
export type TaxCode = 'A' | 'B' | 'C'

/**
 * - ilegible: no se ha podido leer el importe.
 * - deducido: el importe se ha calculado a partir del total.
 * - corregido: el importe leído no cuadraba y se ha corregido con el total.
 * - dudoso: las lecturas no coinciden y el total no permite decidir.
 */
export type TicketLineFlag = 'ilegible' | 'deducido' | 'corregido' | 'dudoso'

export interface ParsedTicketLine {
  /** Orden en el ticket (0, 1, 2…). */
  position: number
  rawName: string
  /** Clave para emparejar con productos (ver nameKey). */
  key: string
  /** Unidades (las líneas «3,95x 2» tienen 2). */
  quantity: number
  unitPriceCents: number | null
  /** Importe de la línea antes de descuentos. Negativo en una devolución. null si no se ha podido leer. */
  amountCents: number | null
  /** Descuentos aplicados a esta línea (Desc., PROMO LIDL PLUS…), en positivo. */
  discountCents: number
  weightKg: number | null
  pricePerKgCents: number | null
  taxCode: TaxCode | null
  flags: TicketLineFlag[]
  evidence?: TicketEvidence
}

/**
 * Estado de la comprobación del total:
 * - cuadra: la suma coincide y no queda ningún dato dudoso.
 * - pendiente: la suma coincide, pero hay datos dudosos (dos errores pueden compensarse).
 * - no_cuadra: hay una diferencia con el total.
 * - incompleto: faltan importes legibles (o líneas), así que la suma no demuestra nada.
 * - sin_total: no se conoce el total del ticket.
 */
export type TicketCheckStatus = 'cuadra' | 'pendiente' | 'no_cuadra' | 'incompleto' | 'sin_total'

export interface TicketCheck {
  status: TicketCheckStatus
  /** Suma de las líneas con importe (importes menos descuentos) y de los ajustes. */
  linesTotalCents: number
  /** Total del ticket menos esa suma (null sin total). */
  differenceCents: number | null
  /** Líneas y ajustes sin importe. */
  unreadable: number
  /** Líneas con datos dudosos o pendientes de confirmar. */
  pending: number
}

export interface ParsedTicket {
  store: TicketStore
  storeName: string
  address: string
  date: ISODate | null
  /** Hora de la compra (HH:MM). */
  time: string | null
  totalCents: number | null
  lines: ParsedTicketLine[]
  check: TicketCheck
  adjustments: TicketAdjustment[]
  issues: string[]
  /** Desglose de IVA del pie del ticket, si se ha leído y es coherente. */
  taxGroups?: TicketTaxGroup[]
  /** «Lidl Pay», «Tarjeta», «Efectivo»… Nunca guarda números de tarjeta. */
  paymentMethod?: string | null
}

/** Un grupo del desglose de IVA: «B 10% 25,50 2,55» → base 25,50 € + cuota 2,55 € = 28,05 €. */
export interface TicketTaxGroup {
  code: TaxCode
  /** En puntos básicos: 10 % = 1000. */
  rateBasisPoints: number
  baseCents: number
  taxCents: number
  grossCents: number
}

export interface TaxGroupCheck {
  code: TaxCode
  grossCents: number
  /** Suma de los artículos con esa letra (importes menos descuentos); null si alguno no tiene importe. */
  linesCents: number | null
  differenceCents: number | null
}

// ---------------------------------------------------------------------------
// Lectura de importes

interface Candidate {
  cents: number
  score: number
  /** Leído tal cual del ticket (no calculado con la cantidad o el peso). */
  read: boolean
}

const TAX_MAP: Record<string, TaxCode> = {
  A: 'A',
  '4': 'A',
  B: 'B',
  '8': 'B',
  '6': 'B',
  '5': 'B',
  '3': 'B',
  E: 'B',
  C: 'C',
  c: 'C',
  '€': 'C',
  '¢': 'C',
  '(': 'C',
}

// Detrás del importe puede venir pegada la letra del IVA, una cifra mal leída o ambas
// («1,758», «1,155A», «1,15-»). Un importe así está deformado: nunca confirma nada. Con dos
// cifras pegadas («1,2398») ya no se interpreta: mejor ilegible que un importe inventado.
const AMOUNT_TOKEN = /^(-?)(\d{1,4})[,.:;](\d{2})(\d?[A-Za-z€¢(]?|-[€¢]?)$/
// La relectura a veces duplica la x («3,95Xx»).
const UNIT_TOKEN = /^(\d{1,4})[,.:;](\d{2})[xX×%*]{1,2}$/
const QTY_TOKEN = /^\d{1,3}$/
const LOOSE_AMOUNT_TOKEN = /^(\d{3,4})\D?$/

const toCents = (integer: string, decimals: string) => Number(integer) * 100 + Number(decimals)

interface AmountToken {
  cents: number
  /** Sin nada pegado detrás salvo, como mucho, la letra del IVA. */
  clean: boolean
  glued: string
  /** Cifras tal como se leyeron, incluidas las pegadas detrás («7,920» → «7920»). */
  rawDigits: string
}

function readAmountToken(token: string): AmountToken | null {
  const match = AMOUNT_TOKEN.exec(token)
  if (!match) return null
  const value = toCents(match[2], match[3])
  const glued = match[4]
  return { cents: match[1] ? -value : value, clean: glued === '' || /^[A-Za-z€¢(]$/.test(glued), glued,
    rawDigits: `${match[2]}${match[3]}${glued.replace(/\D/g, '')}` }
}

const isTaxToken = (token: string) => token.length <= 2 && !/\d[,.]/.test(token) && TAX_MAP[token[0]] !== undefined

interface TailReading {
  /** Palabras del nombre (lo que queda delante de las cifras del final). */
  nameTokens: string[]
  amount: AmountToken | null
  /** Importe aproximado (cifras sin coma, «378»): poco fiable. */
  looseAmountCents: number | null
  unitCents: number | null
  quantity: number | null
  tax: TaxCode | null
  /** El carácter del que sale la letra del IVA: «B» o una cifra que la sustituye («5», «8»). */
  taxRaw: string | null
}

/** Lee el final de una línea: «… 3,95x 2 7,90 B». */
function readTail(allTokens: readonly string[]): TailReading {
  // Signos sueltos al final («7,90 ,»): restos del OCR, no forman parte de la línea.
  let end = allTokens.length
  while (end > 1 && /^[,.;:'`"´·]+$/.test(allTokens[end - 1])) end--
  const tokens = allTokens.slice(0, end)
  let i = tokens.length - 1
  let tax: TaxCode | null = null
  let taxRaw: string | null = null
  if (i > 0 && isTaxToken(tokens[i]) && (readAmountToken(tokens[i - 1]) || LOOSE_AMOUNT_TOKEN.test(tokens[i - 1]))) {
    tax = TAX_MAP[tokens[i][0]]
    taxRaw = tokens[i][0]
    i--
  }
  let amount: AmountToken | null = null
  let looseAmountCents: number | null = null
  const token = tokens[i]
  if (token !== undefined && (amount = readAmountToken(token))) {
    // «1,155A»: la letra pegada manda sobre la cifra mal leída.
    if (!tax && amount.glued) {
      const letter = amount.glued.replace(/[\d-]/g, '')[0]
      tax = TAX_MAP[letter ?? amount.glued[0]] ?? TAX_MAP[amount.glued[0]] ?? null
      if (tax) taxRaw = TAX_MAP[letter ?? ''] ? letter! : amount.glued[0]
      // «1,798» sin letra de IVA aparte: el 8 es la B leída como cifra, no una cifra de más.
      // (Con la letra aparte, «2,992 A», la cifra pegada sí sobra y el importe queda deformado.)
      if (/^\d$/.test(amount.glued) && tax) amount = { ...amount, clean: true, glued: '', rawDigits: amount.rawDigits.slice(0, -1) }
    }
    i--
  } else if (token !== undefined && LOOSE_AMOUNT_TOKEN.test(token) && i > 0) {
    looseAmountCents = Number(LOOSE_AMOUNT_TOKEN.exec(token)![1])
    i--
  }

  let unitCents: number | null = null
  let quantity: number | null = null
  if (!amount && looseAmountCents === null) {
    // Importe ilegible («4,95X 2 9,?0 A»): el precio y la cantidad se leen igual, para no
    // meterlos en el nombre y para poder proponer el calculado. La letra del IVA, si está, también.
    let j = i
    if (j >= 3 && isTaxToken(tokens[j]) && /\d/.test(tokens[j - 1])) j--
    const unit = j >= 2 && /^[^\p{L}]+$/u.test(tokens[j]) && !QTY_TOKEN.test(tokens[j]) ? UNIT_TOKEN.exec(tokens[j - 2]) : null
    if (unit && QTY_TOKEN.test(tokens[j - 1])) {
      if (j !== i) { tax = TAX_MAP[tokens[i][0]]; taxRaw = tokens[i][0] }
      unitCents = toCents(unit[1], unit[2])
      quantity = Number(tokens[j - 1])
      i = j - 3
    }
  }
  if (amount || looseAmountCents !== null) {
    const unit = i >= 1 ? UNIT_TOKEN.exec(tokens[i - 1]) : null
    if (unit && QTY_TOKEN.test(tokens[i])) {
      unitCents = toCents(unit[1], unit[2])
      quantity = Number(tokens[i])
      i -= 2
    } else if (i >= 2 && QTY_TOKEN.test(tokens[i]) && /^[xX×*]{1,2}$/.test(tokens[i - 1]) && readAmountToken(tokens[i - 2])?.clean) {
      unitCents = readAmountToken(tokens[i - 2])!.cents
      quantity = Number(tokens[i])
      i -= 3
    } else if (i >= 1 && QTY_TOKEN.test(tokens[i]) && amount) {
      // «3,95 2 7,90»: sin la x, solo si la multiplicación cuadra.
      const plain = readAmountToken(tokens[i - 1])
      if (plain?.clean && plain.cents * Number(tokens[i]) === amount.cents) {
        unitCents = plain.cents
        quantity = Number(tokens[i])
        i -= 2
      }
    }
  }
  return { nameTokens: tokens.slice(0, i + 1), amount, looseAmountCents, unitCents, quantity, tax, taxRaw }
}

// ---------------------------------------------------------------------------
// Limpieza de líneas

/** Letras que el OCR pone en lugar de cifras. Solo se cambian dentro de algo con forma de importe. */
const DIGIT_LOOKALIKES: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', S: '5', B: '8', Z: '2' }
/**
 * Un importe con letras parecidas a cifras: «5,O8», «I,29», «3,79B». La segunda
 * cifra decimal nunca puede ser una B: «3,7B» es «3,7» seguido de la letra del
 * IVA (mal leído) y no 3,78; ni una «l» minúscula: «1,5l» es litro y medio.
 * Exige al menos una cifra de verdad, para no tocar palabras.
 */
const LOOKALIKE_AMOUNT = /(?<![\p{L}\d])([0-9OoIlSZB]{1,4})([,.:;])([0-9OoIlSZB])([0-9OoISZ])(?=[xX×*]|[ABC]?(?![\p{L}\d]))/gu

function replaceLookalikes(text: string): { text: string; replaced: boolean } {
  let replaced = false
  const result = text.replace(LOOKALIKE_AMOUNT, (match, integer: string, separator: string, d1: string, d2: string) => {
    if (!/\d/.test(integer + d1 + d2)) return match
    const fixed = (integer + d1 + d2).replace(/[OoIlSZB]/g, c => DIGIT_LOOKALIKES[c])
    if (fixed !== integer + d1 + d2) replaced = true
    return `${fixed.slice(0, integer.length)}${separator}${fixed.slice(integer.length)}`
  })
  return { text: result, replaced }
}

/** Arregla lo que el OCR separa o ensucia: «0, 99x» → «0,99x», «2 ,84X» → «2,84X», rayas y subrayados → espacio. */
function cleanText(text: string): string {
  const spaced = text
    .replace(/[−–](?=\s*\d)/g, '-')
    .replace(/[—–_|]+/g, ' ')
    .replace(/(\d)\s*([,.:;])\s+(?=\d)/g, '$1$2')
    .replace(/(\d)\s+([,.])(?=\d{2}(?:\b|[xX×]))/g, '$1$2')
    // «2,84x2» → «2,84x 2»: la cantidad pegada al multiplicador.
    .replace(/(\d[,.:;]\d{2}\s*[xX×*]{1,2})(?=\d{1,3}(?!\d|[,.:;]\d))/g, '$1 ')
  return replaceLookalikes(spaced).text.replace(/\s+$/g, '')
}

const hasLookalikeDigits = (text: string) => replaceLookalikes(text.replace(/(\d)\s*([,.:;])\s+(?=\S)/g, '$1$2')).replaced

const tokensOf = (text: string) => text.trim().split(/\s+/).filter(Boolean)
const letterCount = (text: string) => (text.match(/\p{L}/gu) ?? []).length

/** Donde empieza el primer hueco grande (3 o más espacios): separa la columna del nombre de la de los importes. */
function firstGapTokenIndex(text: string): number | null {
  const gap = /\S(\s{3,})\S/.exec(text)
  if (!gap) return null
  return tokensOf(text.slice(0, gap.index + 1)).length
}

const isSeparator = (text: string) => /^[\s\-=*_.·•]*$/.test(text)
const WEIGHT_LINE = /(\d{1,3})\s?[,.]\s?(\d{3})\s*kg\b.*?[xX×*]\s*(\d{1,4})\s?[,.:;]\s?(\d{2})/i
const DISCOUNT_LINE = /^\s*(desc\b|desc\.|desc,|dto\b|descuento|promo\b|cup[oó]n|ahorro)/i
const TOTAL_LINE = /^\s*TOTAL\b(?!\s*(oferta|desc|ahorro))/i
const HEADER_WORDS = /^\s*(descripci[oó]n|cantidad|p\.?\s*unit|precio|importe|eur)\b/i

export const PAYMENT_LINE = /^\s*(Lidl\s*Pay|tarjeta|efectivo|cambio|pagado|pago\b|m[eé]todo de pago|comercio:|num\.?\s*operaci[oó]n|FECHA:|HORA:|CAJA:|IMPORTE:)/i
export const FISCAL_LINE = /^\s*(IVA\b|I\.?V\.?A\.?\s|TIPO\s+IVA|BASE\s+IMP|CUOTA\b|[ABC]\s+\d{1,2}[,.]?\d*\s*%)/i
export const PROMOTIONAL_LINE = /^\s*(ofertas?\b|puntos?\b|recompensas?\b|gracias\b|atenci[oó]n\b|compra realizada|pr[oó]xima compra|v[aá]lido|www\.|tel[eé]fono|ahorro\s+total|total\s+(ahorro|desc|oferta)|has ahorrado)/i
export const endsProducts = (text: string) => PAYMENT_LINE.test(text) || FISCAL_LINE.test(text) || PROMOTIONAL_LINE.test(text)

// ---------------------------------------------------------------------------
// Varias capturas de un mismo ticket

/**
 * Une las líneas de varias capturas. Si una captura empieza repitiendo las
 * últimas líneas de la anterior (al hacer capturas de un ticket largo), esas
 * líneas repetidas se quitan. Se exigen al menos dos líneas seguidas iguales
 * para no borrar productos repetidos de verdad.
 */
export function mergePages(pages: readonly (readonly OcrLine[])[]): OcrLine[] {
  const merged: OcrLine[] = []
  const same = (a: OcrLine, b: OcrLine) => {
    const x = readTail(tokensOf(cleanText(a.text)))
    const y = readTail(tokensOf(cleanText(b.text)))
    return nameKey(a.text) !== '' && similarity(a.text, b.text) >= 0.95 &&
      x.amount?.cents === y.amount?.cents && x.quantity === y.quantity && x.unitCents === y.unitCents && x.tax === y.tax
  }
  for (const page of pages) {
    // Internal strips refer to the same source coordinate system. Match by
    // geometry, never by name alone: repeated products have distinct boxes.
    if (page[0]?.source && merged.some(l => l.source?.imageIndex === page[0].source!.imageIndex)) {
      for (const line of page) {
        const source = line.source
        const duplicate = source && merged.findIndex(l => l.source?.imageIndex === source.imageIndex &&
          Math.abs((l.source.box.y0 + l.source.box.y1) / 2 - (source.box.y0 + source.box.y1) / 2) <
          Math.max(4, (source.box.y1 - source.box.y0) / 2))
        if (typeof duplicate === 'number' && duplicate >= 0) {
          if ((line.confidence ?? 0) > (merged[duplicate].confidence ?? 0)) merged[duplicate] = line
        } else merged.push(line)
      }
      continue
    }
    let overlap = 0
    for (let k = Math.min(merged.length, page.length, 40); k >= 2; k--) {
      let all = true
      for (let j = 0; j < k && all; j++) all = same(merged[merged.length - k + j], page[j])
      if (all && new Set(page.slice(0, k).map(l => nameKey(l.text))).size >= 2) {
        overlap = k
        break
      }
    }
    merged.push(...page.slice(overlap))
  }
  return merged
}

// ---------------------------------------------------------------------------
// Cabecera: tienda, dirección, fecha, hora

function detectStore(lines: readonly OcrLine[]): TicketStore {
  return lines.slice(0, 15).some((line) => /\bLIDL\b/i.test(line.text)) ? 'lidl' : 'otra'
}

function storeNameOf(store: TicketStore, lines: readonly OcrLine[]): string {
  if (store === 'lidl') return 'Lidl'
  const first = lines.find((line) => letterCount(line.text) >= 3)
  if (!first) return 'Tienda'
  const name = first.text
    .replace(/\b(S\.?\s?A\.?\s?U?\.?|S\.?\s?L\.?\s?U?\.?)\s*$/i, '')
    .replace(/[,.\s]+$/, '')
    .trim()
  const pretty = name.charAt(0).toLocaleUpperCase('es') + name.slice(1).toLocaleLowerCase('es')
  return pretty.slice(0, 60) || 'Tienda'
}

function addressOf(store: TicketStore, lines: readonly OcrLine[]): string {
  if (store !== 'lidl') return ''
  const header = lines.findIndex((line) => /LIDL\s+SUPERMERCADOS/i.test(line.text))
  if (header === -1) return ''
  const parts: string[] = []
  for (const line of lines.slice(header + 1, header + 5)) {
    if (/\bNIF\b|www\.|^\s*EUR\s*$/i.test(line.text)) break
    const text = line.text.replace(/(\d{5})(?=\p{L})/u, '$1 ').replace(/\s+/g, ' ').trim()
    if (text) parts.push(text)
  }
  return parts.slice(0, 2).join(', ').slice(0, 120)
}

function readDate(day: string, month: string, year: string): ISODate | null {
  const fullYear = year.length === 2 ? 2000 + Number(year) : Number(year)
  const iso = toISODate(fullYear, Number(month), Number(day))
  return isValidISODate(iso) ? iso : null
}

function dateAndTime(lines: readonly OcrLine[]): { date: ISODate | null; time: string | null } {
  let date: ISODate | null = null
  let time: string | null = null
  for (const { text } of lines) {
    const labeledDate = /FECHA\W*(\d{2})[/.-](\d{2})[/.-](\d{2,4})/i.exec(text)
    if (labeledDate && !date) date = readDate(labeledDate[1], labeledDate[2], labeledDate[3])
    const labeledTime = /HORA\W*(\d{2})[:.](\d{2})/i.exec(text)
    if (labeledTime && !time && Number(labeledTime[1]) < 24 && Number(labeledTime[2]) < 60) time = `${labeledTime[1]}:${labeledTime[2]}`
  }
  if (!date || !time) {
    // Pie del ticket («4017 564330/01 28.10.26 19:22») u otras tiendas («28/10/2026 19:24»).
    for (const { text } of lines) {
      const match = /\b(\d{2})[/.-](\d{2})[/.-](\d{2}|\d{4})\b(?:\s+(\d{2}):(\d{2}))?/.exec(text)
      if (!match) continue
      const found = readDate(match[1], match[2], match[3])
      if (!found) continue
      date ??= found
      if (!time && match[4] && Number(match[4]) < 24 && Number(match[5]) < 60) time = `${match[4]}:${match[5]}`
      if (date && time) break
    }
  }
  return { date, time }
}

// ---------------------------------------------------------------------------
// Productos

interface WorkLine {
  position: number
  rawName: string
  quantity: number
  unitCents: number | null
  weightKg: number | null
  pricePerKgCents: number | null
  taxCode: TaxCode | null
  /** Importes leídos (nunca calculados), con su puntuación. */
  amount: Candidate[]
  /** Cada lectura del importe por separado, con sus cifras en bruto. */
  readings: { text: AmountToken | null; reread: AmountToken | null }
  /** Las dos pasadas del OCR leyeron igual el precio y la cantidad (o el peso y el precio por kilo). */
  inputsStable: boolean
  confidence: { amount?: number; inputs?: number }
  discounts: Candidate[][]
  source: OcrLine
  issues: string[]
  /** Indicios de que el importe puede tener una cifra confundida. Una multiplicación que coincide los resuelve. */
  amountDoubts: string[]
}

function addCandidate(list: Candidate[], cents: number, score: number, read = true): void {
  const existing = list.find((c) => c.cents === cents)
  if (existing) {
    existing.score += score
    existing.read ||= read
  } else list.push({ cents, score, read })
}

const minConfidence = (values: readonly (number | undefined)[]) => {
  const known = values.filter((v): v is number => typeof v === 'number')
  return known.length ? Math.min(...known) : undefined
}

/** Confianza de Tesseract en el importe y en el precio × cantidad de una línea, si el OCR la da por palabra. */
function wordConfidence(line: OcrLine): { amount?: number; inputs?: number } {
  const words = (line.words ?? []).map(w => ({ text: cleanText(w.text), confidence: w.confidence }))
  let amount: number | undefined
  let amountIndex = -1
  for (let i = words.length - 1; i >= 0; i--) {
    if (/\d[,.:;]\d{2}/.test(words[i].text) && !/[xX×*]/.test(words[i].text)) { amount = words[i].confidence; amountIndex = i; break }
  }
  const unitIndex = words.findIndex((w, i) => i < amountIndex && (/\d[,.:;]\d{2}[xX×*]/.test(w.text) ||
    (/\d[,.:;]\d{2}$/.test(w.text) && /^[xX×*]{1,2}$/.test(words[i + 1]?.text ?? ''))))
  if (unitIndex === -1) return { amount }
  const quantity = words.slice(unitIndex + 1, amountIndex).find(w => /^\d{1,3}$/.test(w.text))
  return { amount, inputs: minConfidence([words[unitIndex].confidence, quantity?.confidence]) }
}

function readWeight(line: OcrLine): { weightKg: number; pricePerKgCents: number; agreed: boolean; confidence?: number } | null {
  const reads = [line.reread, line.text].flatMap((text) => {
    const match = text ? WEIGHT_LINE.exec(text) : null
    return match ? [{ weightKg: Number(`${match[1]}.${match[2]}`), pricePerKgCents: toCents(match[3], match[4]) }] : []
  })
  if (reads.length === 0) return null
  const agreed = reads.length === 2 && reads[0].weightKg === reads[1].weightKg && reads[0].pricePerKgCents === reads[1].pricePerKgCents
  const confidence = minConfidence((line.words ?? []).filter(w => /\d/.test(w.text)).map(w => w.confidence))
  return { ...reads[0], agreed, confidence }
}

function readItemLine(line: OcrLine, position: number): WorkLine | null {
  const text = cleanText(line.text)
  const tokens = tokensOf(text)
  if (tokens.length === 0) return null
  const fromText = readTail(tokens)
  const fromReread = line.reread ? readTail(tokensOf(cleanText(line.reread))) : null

  // El nombre no pasa del primer hueco grande: lo de después son importes (aunque estén mal leídos).
  const uncut = fromText.nameTokens
  let nameTokens = uncut
  const gap = firstGapTokenIndex(text)
  if (gap !== null && gap < nameTokens.length) nameTokens = nameTokens.slice(0, gap)
  // Sin importe al final, se quitan los restos con cifras y signos («1-29:B»).
  if (!fromText.amount) {
    // «PAN 3 KG 1,2? A»: la letra del IVA detrás de un importe ilegible tampoco es del nombre.
    if (nameTokens.length > 2 && isTaxToken(nameTokens.at(-1)!) && nameTokens.at(-1)!.length === 1 && /\d/.test(nameTokens.at(-2)!)) nameTokens = nameTokens.slice(0, -1)
    while (nameTokens.length > 1 && /\d/.test(nameTokens[nameTokens.length - 1]) && /[^\p{L}\d]/u.test(nameTokens[nameTokens.length - 1])) {
      nameTokens = nameTokens.slice(0, -1)
    }
  }
  // Otras tiendas ponen la cantidad delante: «2 YOGUR GRIEGO 1,20 2,40» o «1 PAN BARRA 0,60».
  let leadingQuantity: number | null = null
  let leadingUnitCents: number | null = null
  if (nameTokens.length >= 2 && QTY_TOKEN.test(nameTokens[0]) && letterCount(nameTokens[1]) > 0) {
    const count = Number(nameTokens[0])
    const unit = readAmountToken(uncut[uncut.length - 1])
    if (unit?.clean && fromText.amount && unit.cents * count === fromText.amount.cents) {
      leadingQuantity = count
      leadingUnitCents = unit.cents
      nameTokens = nameTokens.slice(1)
      if (nameTokens.length === uncut.length - 1) nameTokens = nameTokens.slice(0, -1)
    } else if (count >= 1 && count <= 99) {
      leadingQuantity = count
      nameTokens = nameTokens.slice(1)
    }
  }
  const rawName = nameTokens.join(' ').replace(/[,;:]+$/, '').trim()
  if (letterCount(rawName) < 2) return null

  const amount: Candidate[] = []
  // La relectura de solo cifras confunde 9 con 3 y la B con 5 («3,73 5» por «3,79B»); la lectura
  // normal suele fallar añadiendo una cifra pegada («2,792 A»). Un importe limpio en la lectura
  // normal manda; si no lo es, manda la relectura. La multiplicación NO puntúa aquí: se usa
  // después como evidencia independiente (ver selectLine y evidence.ts).
  if (fromReread?.amount) addCandidate(amount, fromReread.amount.cents, fromReread.amount.clean ? 2 : 1.5)
  if (fromText.amount) addCandidate(amount, fromText.amount.cents, fromText.amount.clean ? 2.5 : 0.7)
  if (fromReread && fromReread.looseAmountCents !== null) addCandidate(amount, fromReread.looseAmountCents, 0.4)
  if (fromText.looseAmountCents !== null) addCandidate(amount, fromText.looseAmountCents, 0.4)

  // Cantidad y precio unitario: de las dos lecturas, la que cuadra con algún importe leído; si ninguna, la normal.
  const options = [fromText, fromReread].filter((r): r is TailReading => r !== null && r.unitCents !== null && r.quantity !== null)
  const consistent = options.find((r) => amount.some((c) => c.cents === r.unitCents! * r.quantity!))
  const chosen = consistent ?? options[0]
  const unitCents = chosen?.unitCents ?? leadingUnitCents
  const quantity = chosen?.quantity && chosen.quantity > 0 ? chosen.quantity : (leadingQuantity ?? 1)
  const plainUnit = fromReread && fromReread.unitCents === null ? readPlainUnit(fromReread) : null
  const inputsStable = (options.length === 2 && options[0].unitCents === options[1].unitCents && options[0].quantity === options[1].quantity) ||
    (plainUnit !== null && plainUnit.unitCents === unitCents && plainUnit.quantity === quantity)

  const amountDoubts: string[] = []
  const taxCode = fromReread?.tax ?? fromText.tax
  // «3,73 5» en vez de «3,79B»: si la letra del IVA solo aparece como cifra, el OCR ha leído
  // la línea como si fueran cifras y el importe puede tener otra cifra confundida.
  if (taxCode && ![fromText, fromReread].some(r => r?.taxRaw && /\p{L}/u.test(r.taxRaw))) {
    amountDoubts.push(`La letra del IVA se ha leído como la cifra «${fromText.taxRaw ?? fromReread?.taxRaw}»: puede haber otra cifra confundida en el importe`)
  }
  if (!fromText.amount && fromReread?.amount) amountDoubts.push('El importe solo se lee en la relectura de cifras')
  if (hasLookalikeDigits(line.text) || (line.reread && hasLookalikeDigits(line.reread))) amountDoubts.push('Se han interpretado letras como cifras')

  return {
    position,
    rawName,
    quantity,
    unitCents,
    weightKg: null,
    pricePerKgCents: null,
    taxCode,
    amount,
    readings: { text: fromText.amount, reread: fromReread?.amount ?? null },
    inputsStable,
    confidence: wordConfidence(line),
    discounts: [],
    source: line,
    issues: [],
    amountDoubts,
  }
}

/** «3,95 2 7,20 B» (sin la x): precio y cantidad aunque no cuadren con el importe, solo para comparar lecturas. */
function readPlainUnit(reading: TailReading): { unitCents: number; quantity: number } | null {
  const tokens = reading.nameTokens
  if (tokens.length < 2) return null
  const quantity = tokens[tokens.length - 1]
  const unit = readAmountToken(tokens[tokens.length - 2])
  return unit?.clean && QTY_TOKEN.test(quantity) ? { unitCents: unit.cents, quantity: Number(quantity) } : null
}

function readDiscount(line: OcrLine): Candidate[] {
  const candidates: Candidate[] = []
  for (const [text, score] of [
    [line.reread, 2],
    [line.text, 1],
  ] as const) {
    if (!text) continue
    const tokens = tokensOf(cleanText(text))
    for (let i = tokens.length - 1; i >= 0; i--) {
      const amount = readAmountToken(tokens[i])
      if (amount) {
        addCandidate(candidates, Math.abs(amount.cents), score)
        break
      }
    }
  }
  return candidates
}

// ---------------------------------------------------------------------------
// Selección local: el total nunca modifica un dato de producto.
const sorted = (candidates: readonly Candidate[]) => [...candidates].sort((a, b) => b.score - a.score || a.cents - b.cents)

const asReading = (token: AmountToken): AmountReading => ({ cents: token.cents, rawDigits: token.rawDigits, malformed: !token.clean,
  printed: `${token.cents < 0 ? '-' : ''}${token.rawDigits.slice(0, -2 - token.glued.replace(/\D/g, '').length)},${token.rawDigits.slice(-2 - token.glued.replace(/\D/g, '').length)}` })

function selectLine(line: WorkLine): ParsedTicketLine {
  const reads = sorted(line.amount)
  const { text: textToken, reread: rereadToken } = line.readings
  const readings = [textToken, rereadToken].filter((t): t is AmountToken => t !== null).map(asReading)
  const chosen = reads[0] ?? null
  // La lectura elegida, con sus cifras en bruto (una lectura sin coma, «378», cuenta como deformada).
  const recognized: AmountReading | null = chosen === null ? null :
    readings.find(r => r.cents === chosen.cents) ?? { cents: chosen.cents, rawDigits: printedDigits(chosen.cents), malformed: true }
  const flags = new Set<TicketLineFlag>()
  const issues = [...line.issues]
  const options: TicketAmountOption[] = []
  let amount: number | null = recognized?.cents ?? null
  let selectedBy: TicketEvidence['selectedBy'] = rereadToken && textToken?.cents !== amount && rereadToken.cents === amount ? 'reread' : 'read'
  let discrepancy: TicketDiscrepancy | undefined

  const weighted = line.weightKg !== null && line.pricePerKgCents !== null
  const grams = weighted ? Math.round(line.weightKg! * 1000) : 0
  const sign = (recognized?.cents ?? 0) < 0 ? -1 : 1
  const calculated = weighted ? sign * roundRatio(grams * line.pricePerKgCents!, 1000)
    : line.unitCents !== null ? sign * line.unitCents * line.quantity : null
  const common = recognized && {
    recognized, readings: readings.length ? readings : [recognized], inputsStable: line.inputsStable,
    amountStable: readings.length === 2 && readings[0].cents === readings[1].cents, confidence: line.confidence,
  }

  if (calculated !== null && recognized === null) {
    // Importe ilegible: se propone el cálculo, pero es un dato sugerido, no leído.
    amount = calculated
    selectedBy = 'calculation'
    flags.add('deducido')
    options.push({ cents: calculated, origin: 'calculation' })
    issues.push(`No se lee el importe; ${weighted ? 'peso × precio por kilo' : 'precio × cantidad'} da ${formatEuros(calculated)}: confírmalo`)
  } else if (calculated !== null && common && calculated !== recognized!.cents) {
    discrepancy = (weighted
      ? assessWeight({ ...common, grams, pricePerKgCents: line.pricePerKgCents! })
      : assessUnits({ ...common, unitCents: line.unitCents!, quantity: line.quantity }))!
    issues.push(discrepancy.explanation)
    const read = { cents: recognized!.cents, origin: selectedBy === 'reread' ? 'reread' : 'read' } as const
    if (discrepancy.verdict === 'calculation') {
      amount = calculated
      selectedBy = readings.some(r => r.cents === calculated) && textToken?.cents !== calculated ? 'reread' : 'calculation'
      flags.add('corregido')
      options.push({ cents: calculated, origin: 'calculation' }, read)
    } else if (discrepancy.verdict === 'read') {
      options.push(read, { cents: calculated, origin: 'calculation' })
    } else {
      // Ambiguo: no se elige ninguna cifra. Las dos quedan a mano en la revisión.
      amount = null
      options.push({ cents: calculated, origin: 'calculation' }, read)
    }
  } else if (calculated === null && reads.length > 1) {
    issues.push('Las lecturas del importe no coinciden')
    // Botones solo para lecturas con forma de importe («2,99»), nunca para cifras sueltas sin coma («373»).
    if (textToken && rereadToken && textToken.cents !== rereadToken.cents) {
      const both: TicketAmountOption[] = [{ cents: textToken.cents, origin: 'read' }, { cents: rereadToken.cents, origin: 'reread' }]
      options.push(...(selectedBy === 'reread' ? both.reverse() : both))
    }
  }
  if (calculated === null && textToken && !rereadToken && line.source.reread) {
    // Relectura con cifras que no se puede interpretar («2795» frente a «3,72B»): las dos pasadas no coinciden.
    const digits = line.source.reread.replace(/\D/g, '')
    if (digits.length >= 3 && !digits.startsWith(textToken.rawDigits.slice(0, 3))) {
      issues.push(`La relectura de cifras no confirma el importe («${line.source.reread.trim()}»)`)
    }
  }
  if (calculated === null) {
    // «2,939»: el OCR vio una cifra de más. Quitar la última es una suposición (podía sobrar la del
    // medio), así que una lectura deformada no confirma el importe aunque otra lectura coincida.
    const deformed = [textToken, rereadToken].find(t => t && !t.clean && /\d/.test(t.glued))
    if (deformed) issues.push(`Una lectura del importe tiene cifras de más («${asReading(deformed).printed}»): confirma el importe`)
  }
  // Si el importe leído coincide con la multiplicación, esa coincidencia resuelve el desacuerdo entre lecturas.

  if (amount === null && !discrepancy) { flags.add('ilegible'); issues.push('No se lee el importe') }
  // Una multiplicación que coincide con el importe leído es una comprobación independiente: resuelve la baja confianza.
  const verifiedByArithmetic = calculated !== null && recognized !== null && calculated === recognized.cents
  if ((line.source.confidence ?? 100) < 75 && !verifiedByArithmetic) issues.push('Lectura de baja confianza')
  if (!verifiedByArithmetic) issues.push(...line.amountDoubts)
  let discountCents = 0
  for (const discount of line.discounts) {
    const choices = sorted(discount)
    discountCents += choices[0]?.cents ?? 0
    if (!choices.length || choices.length > 1) issues.push('Descuento ilegible o ambiguo')
  }
  if (amount !== null && discountCents > Math.max(0, amount)) issues.push('Descuento mayor que el importe')
  if (issues.length && !flags.has('ilegible')) flags.add('dudoso')
  return { position: line.position, rawName: line.rawName, key: nameKey(line.rawName), quantity: line.quantity,
    unitPriceCents: line.unitCents, amountCents: amount, discountCents, weightKg: line.weightKg,
    pricePerKgCents: line.pricePerKgCents, taxCode: line.taxCode, flags: [...flags],
    evidence: { text: line.source.text, reread: line.source.reread, normalized: cleanText(line.source.text),
      recognizedCents: textToken?.cents ?? recognized?.cents ?? null,
      calculatedCents: calculated, selectedBy, issues: [...new Set(issues)],
      ...(discrepancy ? { discrepancy } : {}), ...(options.length ? { options } : {}), source: line.source.source } }
}

// ---------------------------------------------------------------------------
// Total

function readTotal(lines: readonly OcrLine[], totalIndex: number | null): number | null {
  const votes: Candidate[] = []
  const lastAmount = (text: string | null) => {
    if (!text) return null
    const tokens = tokensOf(cleanText(text))
    for (let i = tokens.length - 1; i >= 0; i--) {
      const amount = readAmountToken(tokens[i])
      if (amount) return amount.cents
    }
    return null
  }
  if (totalIndex !== null) {
    const fromReread = lastAmount(lines[totalIndex].reread)
    const fromText = lastAmount(lines[totalIndex].text)
    if (fromText !== null) return fromText
    if (fromReread !== null) return fromReread
  }
  for (const line of lines.slice(totalIndex ?? 0)) {
    if (/^\s*(IMPORTE|Lidl\s*Pay|TARJETA|Suma)\b/i.test(line.text)) {
      const value = lastAmount(line.text)
      if (value !== null) addCandidate(votes, value, 1)
    }
  }
  return sorted(votes)[0]?.cents ?? null
}

// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Pie del ticket: desglose de IVA y medio de pago

// «Cc 21%»: a veces el OCR duplica la letra en minúscula.
const TAX_GROUP_LINE = /^\s*(?:IVA\s+)?([ABC])[abc]?\s+(\d{1,2})(?:[,.](\d{1,2}))?\s*%\s+(.+)$/

/**
 * Lee el desglose de IVA. Solo se acepta un grupo si es coherente por sí mismo:
 * una de sus cifras tiene que ser la cuota (base × tipo, ±1 céntimo). Así un
 * pie con otro formato no produce comprobaciones falsas.
 */
export function readTaxGroups(lines: readonly OcrLine[]): TicketTaxGroup[] {
  const groups: TicketTaxGroup[] = []
  for (const line of lines) {
    const match = TAX_GROUP_LINE.exec(cleanText(line.text))
    if (!match) continue
    const code = match[1].toUpperCase() as TaxCode
    if (groups.some(g => g.code === code)) continue
    const rateBasisPoints = Number(match[2]) * 100 + Number((match[3] ?? '0').padEnd(2, '0'))
    const amounts = tokensOf(match[4]).map(readAmountToken).filter((a): a is AmountToken => a !== null && a.clean && a.cents >= 0).map(a => a.cents)
    let found: TicketTaxGroup | null = null
    for (const base of amounts) {
      for (const tax of amounts) {
        if (base === tax || found) continue
        if (Math.abs(roundRatio(base * rateBasisPoints, 10_000) - tax) <= 1) found = { code, rateBasisPoints, baseCents: base, taxCents: tax, grossCents: base + tax }
      }
    }
    // Con tres cifras, la tercera debe ser la suma: si no lo es, el grupo no se usa.
    if (found && amounts.length >= 3 && !amounts.includes(found.grossCents)) found = null
    if (found) groups.push(found)
  }
  return groups
}

/**
 * Compara cada grupo del desglose de IVA con la suma de sus artículos. Es una
 * comprobación cruzada: detecta dos errores que se compensan en el total si
 * caen en grupos distintos. No cambia ninguna cifra. No es concluyente si hay
 * ajustes generales (no se sabe a qué grupo pertenecen) o artículos sin letra.
 */
export function checkTaxGroups(
  lines: readonly Pick<ParsedTicketLine, 'amountCents' | 'discountCents' | 'taxCode'>[],
  groups: readonly TicketTaxGroup[] = [],
  adjustments: readonly Pick<TicketAdjustment, 'amountCents'>[] = [],
): { conclusive: boolean; mismatches: number; groups: TaxGroupCheck[] } {
  const conclusive = groups.length > 0 && lines.every(l => l.taxCode !== null) && !adjustments.some(a => (a.amountCents ?? 1) !== 0) &&
    lines.every(l => groups.some(g => g.code === l.taxCode))
  const checks = groups.map(group => {
    const own = lines.filter(l => l.taxCode === group.code)
    const linesCents = own.some(l => l.amountCents === null) ? null : own.reduce((sum, l) => sum + l.amountCents! - l.discountCents, 0)
    return { code: group.code, grossCents: group.grossCents, linesCents, differenceCents: linesCents === null ? null : group.grossCents - linesCents }
  })
  return { conclusive, groups: checks, mismatches: conclusive ? checks.filter(c => c.differenceCents !== null && c.differenceCents !== 0).length : 0 }
}

function paymentMethodOf(lines: readonly OcrLine[]): string | null {
  for (const { text } of lines) {
    if (/Lidl\s*Pay/i.test(text)) return 'Lidl Pay'
    if (/\b(tarjeta|visa|mastercard|maestro|d[eé]bito|cr[eé]dito|contactless)\b/i.test(text)) return 'Tarjeta'
    if (/\b(efectivo|entregado)\b/i.test(text)) return 'Efectivo'
  }
  return null
}
/**
 * Suma de las líneas y si cuadra con el total. Sirve también tras editar
 * importes en la revisión. Nunca cambia una cifra: solo dice qué pasa.
 */
export function checkTicket(
  lines: readonly (Pick<ParsedTicketLine, 'amountCents' | 'discountCents'> & { pending?: boolean })[],
  totalCents: number | null,
  adjustments: readonly Pick<TicketAdjustment, 'amountCents'>[] = [],
  { incomplete = false }: { incomplete?: boolean } = {},
): TicketCheck {
  const linesTotalCents = lines.reduce((sum, line) => sum + (line.amountCents ?? 0) - line.discountCents, 0) + adjustments.reduce((sum, a) => sum + (a.amountCents ?? 0), 0)
  const unreadable = lines.filter((line) => line.amountCents === null).length + adjustments.filter(a => a.amountCents === null).length
  const pending = lines.filter(line => line.pending === true).length
  const differenceCents = totalCents === null ? null : totalCents - linesTotalCents
  const status: TicketCheckStatus = totalCents === null ? 'sin_total'
    : unreadable > 0 || incomplete ? 'incompleto'
      : differenceCents !== 0 ? 'no_cuadra'
        : pending > 0 ? 'pendiente' : 'cuadra'
  return { status, linesTotalCents, differenceCents, unreadable, pending }
}

export const CHECK_LABELS: Record<TicketCheckStatus, string> = {
  cuadra: 'Cuadra con el total',
  pendiente: 'Pendiente de confirmar',
  no_cuadra: 'No cuadra',
  incompleto: 'Incompleto',
  sin_total: 'Sin total',
}

/** Texto pegado (por ejemplo, de un ticket por email) como si fuera una captura. */
export function linesFromText(text: string): OcrLine[] {
  return text.split(/\r?\n/).map((line) => ({ text: line, reread: null }))
}
