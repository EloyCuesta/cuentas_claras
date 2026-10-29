import { isValidISODate, toISODate } from './dates.ts'
import { nameKey, similarity } from './ticketText.ts'
import type { ISODate, OcrLine } from './types.ts'

/**
 * Analizador de tickets de la compra: convierte las líneas leídas por el OCR
 * (o el texto pegado por el usuario) en tienda, fecha, total y productos.
 *
 * Está pensado para el ticket de Lidl (app Lidl Plus o papel), con un modo
 * genérico para otras tiendas. Cada línea puede venir con dos lecturas (la
 * normal y la de solo cifras, ver server/ocr.ts). El importe de cada producto
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
}

export interface TicketCheck {
  status: 'cuadra' | 'no_cuadra' | 'sin_total'
  /** Suma de las líneas con importe (importes menos descuentos). */
  linesTotalCents: number
  /** Total del ticket menos la suma de las líneas (null sin total). */
  differenceCents: number | null
  /** Líneas sin importe. */
  unreadable: number
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

// Detrás del importe puede venir pegada la letra del IVA, una cifra mal leída o ambas («1,758», «1,155A», «1,15-»).
const AMOUNT_TOKEN = /^(-?)(\d{1,4})[,.:;](\d{2})(\d?[A-Za-z€¢(]?|-[€¢]?)$/
const UNIT_TOKEN = /^(\d{1,4})[,.:;](\d{2})[xX×%*]$/
const QTY_TOKEN = /^\d{1,3}$/
const LOOSE_AMOUNT_TOKEN = /^(\d{3,4})\D?$/

const toCents = (integer: string, decimals: string) => Number(integer) * 100 + Number(decimals)

interface AmountToken {
  cents: number
  /** Sin nada pegado detrás salvo, como mucho, la letra del IVA. */
  clean: boolean
  glued: string
}

function readAmountToken(token: string): AmountToken | null {
  const match = AMOUNT_TOKEN.exec(token)
  if (!match) return null
  const value = toCents(match[2], match[3])
  const glued = match[4]
  return { cents: match[1] ? -value : value, clean: glued === '' || /^[A-Za-z€¢(]$/.test(glued), glued }
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
}

/** Lee el final de una línea: «… 3,95x 2 7,90 B». */
function readTail(tokens: readonly string[]): TailReading {
  let i = tokens.length - 1
  let tax: TaxCode | null = null
  if (i > 0 && isTaxToken(tokens[i]) && (readAmountToken(tokens[i - 1]) || LOOSE_AMOUNT_TOKEN.test(tokens[i - 1]))) {
    tax = TAX_MAP[tokens[i][0]]
    i--
  }
  let amount: AmountToken | null = null
  let looseAmountCents: number | null = null
  const token = tokens[i]
  if (token !== undefined && (amount = readAmountToken(token))) {
    // «1,155A»: la letra pegada manda sobre la cifra mal leída.
    if (!tax && amount.glued) tax = TAX_MAP[amount.glued.replace(/[\d-]/g, '')[0] ?? amount.glued[0]] ?? TAX_MAP[amount.glued[0]] ?? null
    i--
  } else if (token !== undefined && LOOSE_AMOUNT_TOKEN.test(token) && i > 0) {
    looseAmountCents = Number(LOOSE_AMOUNT_TOKEN.exec(token)![1])
    i--
  }

  let unitCents: number | null = null
  let quantity: number | null = null
  if (amount || looseAmountCents !== null) {
    const unit = i >= 1 ? UNIT_TOKEN.exec(tokens[i - 1]) : null
    if (unit && QTY_TOKEN.test(tokens[i])) {
      unitCents = toCents(unit[1], unit[2])
      quantity = Number(tokens[i])
      i -= 2
    } else if (i >= 2 && QTY_TOKEN.test(tokens[i]) && /^[xX×]$/.test(tokens[i - 1]) && readAmountToken(tokens[i - 2])?.clean) {
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
  return { nameTokens: tokens.slice(0, i + 1), amount, looseAmountCents, unitCents, quantity, tax }
}

// ---------------------------------------------------------------------------
// Limpieza de líneas

/** Arregla lo que el OCR separa o ensucia: «0, 99x» → «0,99x», rayas y subrayados → espacio. */
function cleanText(text: string): string {
  return text
    .replace(/[—–_|]+/g, ' ')
    .replace(/(\d)\s*([,.:;])\s+(?=\d)/g, '$1$2')
    .replace(/(\d)\s+([,.])(?=\d{2}\b)/g, '$1$2')
    .replace(/\s+$/g, '')
}

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
  const same = (a: OcrLine, b: OcrLine) => nameKey(a.text) !== '' && similarity(a.text, b.text) >= 0.85
  for (const page of pages) {
    let overlap = 0
    for (let k = Math.min(merged.length, page.length, 40); k >= 2; k--) {
      let all = true
      for (let j = 0; j < k && all; j++) all = same(merged[merged.length - k + j], page[j])
      if (all) {
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
  amount: Candidate[]
  discounts: Candidate[][]
}

function addCandidate(list: Candidate[], cents: number, score: number, read = true): void {
  const existing = list.find((c) => c.cents === cents)
  if (existing) {
    existing.score += score
    existing.read ||= read
  } else list.push({ cents, score, read })
}

const roundHalfUp = (value: number) => Math.floor(value + 0.5 + 1e-9)

function readWeight(line: OcrLine): { weightKg: number; pricePerKgCents: number; agreed: boolean } | null {
  const reads = [line.reread, line.text].flatMap((text) => {
    const match = text ? WEIGHT_LINE.exec(text) : null
    return match ? [{ weightKg: Number(`${match[1]}.${match[2]}`), pricePerKgCents: toCents(match[3], match[4]) }] : []
  })
  if (reads.length === 0) return null
  const agreed = reads.length === 2 && reads[0].weightKg === reads[1].weightKg && reads[0].pricePerKgCents === reads[1].pricePerKgCents
  return { ...reads[0], agreed }
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
  if (fromReread?.amount) addCandidate(amount, fromReread.amount.cents, fromReread.amount.clean ? 2 : 1.5)
  if (fromText.amount) addCandidate(amount, fromText.amount.cents, fromText.amount.clean ? 1 : 0.7)
  if (fromReread && fromReread.looseAmountCents !== null) addCandidate(amount, fromReread.looseAmountCents, 0.4)
  if (fromText.looseAmountCents !== null) addCandidate(amount, fromText.looseAmountCents, 0.4)

  // Cantidad y precio unitario: las dos lecturas, quedándose con la que cuadra con algún importe.
  const options = [fromText, fromReread].filter((r): r is TailReading => r !== null && r.unitCents !== null && r.quantity !== null)
  const consistent = options.find((r) => amount.some((c) => c.cents === r.unitCents! * r.quantity!))
  const chosen = consistent ?? options[0]
  const unitCents = chosen?.unitCents ?? leadingUnitCents
  const quantity = chosen?.quantity && chosen.quantity > 0 ? chosen.quantity : (leadingQuantity ?? 1)
  // Si las dos lecturas coinciden en precio y cantidad, la multiplicación es muy fiable.
  const agreed = options.length === 2 && options[0].unitCents === options[1].unitCents && options[0].quantity === options[1].quantity
  const plainUnit = fromReread && fromReread.unitCents === null ? readPlainUnit(fromReread) : null
  const unitAgreed = agreed || (plainUnit !== null && plainUnit.unitCents === unitCents && plainUnit.quantity === quantity)
  if (unitCents !== null && quantity > 1) addCandidate(amount, unitCents * quantity, unitAgreed ? 3.5 : 2, false)

  return {
    position,
    rawName,
    quantity,
    unitCents,
    weightKg: null,
    pricePerKgCents: null,
    taxCode: fromReread?.tax ?? fromText.tax,
    amount,
    discounts: [],
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
// Elegir importes con el total

interface Entry {
  line: WorkLine
  /** -1 = importe del producto; 0, 1… = descuento n.º */
  slot: number
  sign: 1 | -1
  candidates: Candidate[]
  chosen: number | null
  flags: Set<TicketLineFlag>
}

const sorted = (candidates: readonly Candidate[]) => [...candidates].sort((a, b) => b.score - a.score || a.cents - b.cents)

/** ¿Se diferencian en una sola cifra? (2,33 € y 2,39 €). */
function oneDigitApart(a: number, b: number): boolean {
  const x = String(Math.abs(a))
  const y = String(Math.abs(b))
  if (x.length !== y.length || Math.sign(a) !== Math.sign(b)) return false
  let differences = 0
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) differences++
  return differences === 1
}

const MAX_COMBINATIONS = 200_000

function solve(entries: Entry[], totalCents: number | null): TicketCheck['status'] {
  for (const entry of entries) entry.candidates = sorted(entry.candidates).slice(0, 3)
  const unknown = entries.filter((e) => e.candidates.length === 0)
  const lowConfidence = (e: Entry) => e.candidates.length > 1 || (e.candidates[0]?.score ?? 0) < 3
  const chooseTop = () => {
    for (const entry of entries) entry.chosen = entry.candidates[0]?.cents ?? null
  }
  const sumChosen = () => entries.reduce((sum, e) => sum + (e.chosen ?? 0) * e.sign, 0)
  const markDoubtful = () => {
    for (const entry of entries) {
      if (entry.candidates.length === 0) entry.flags.add('ilegible')
      else if (lowConfidence(entry)) entry.flags.add('dudoso')
    }
  }

  chooseTop()
  if (totalCents === null) {
    markDoubtful()
    return 'sin_total'
  }

  if (unknown.length === 1) {
    const missing = unknown[0].sign * (totalCents - sumChosen())
    if (missing > 0 && missing < 1_000_000) {
      unknown[0].chosen = missing
      unknown[0].flags.add('deducido')
      for (const entry of entries) if (entry !== unknown[0] && lowConfidence(entry)) entry.flags.add('dudoso')
      return 'cuadra'
    }
  }
  if (unknown.length > 0) {
    markDoubtful()
    return 'no_cuadra'
  }

  // Combinaciones de candidatos de las líneas con dudas, empezando por las menos fiables.
  const ambiguous = entries
    .filter((e) => e.candidates.length > 1)
    .sort((a, b) => a.candidates[0].score - b.candidates[0].score)
    .slice(0, 14)
  const fixedSum = entries.filter((e) => !ambiguous.includes(e)).reduce((sum, e) => sum + e.candidates[0].cents * e.sign, 0)
  let best: { picks: number[]; score: number } | null = null
  let tie = false
  let count = 0
  const picks: number[] = []
  const search = (index: number, sum: number, score: number) => {
    if (count++ > MAX_COMBINATIONS) return
    if (index === ambiguous.length) {
      if (sum !== totalCents) return
      if (!best || score > best.score + 1e-9) {
        best = { picks: [...picks], score }
        tie = false
      } else if (Math.abs(score - best.score) < 1e-9) tie = true
      return
    }
    const entry = ambiguous[index]
    for (let k = 0; k < entry.candidates.length; k++) {
      picks[index] = k
      search(index + 1, sum + entry.candidates[k].cents * entry.sign, score + entry.candidates[k].score)
    }
  }
  search(0, fixedSum, 0)
  const found = best as { picks: number[]; score: number } | null
  if (found) {
    ambiguous.forEach((entry, i) => {
      entry.chosen = entry.candidates[found.picks[i]].cents
      if (found.picks[i] !== 0) entry.flags.add('corregido')
      if (tie) entry.flags.add('dudoso')
    })
    return 'cuadra'
  }

  // Ninguna combinación cuadra: ¿lo explica una sola cifra mal leída en una sola línea?
  const difference = totalCents - sumChosen()
  const fixes = entries.filter((e) => {
    const fixed = (e.chosen as number) + difference * e.sign
    return fixed > 0 && oneDigitApart(e.chosen as number, fixed)
  })
  if (fixes.length === 1) {
    fixes[0].chosen = (fixes[0].chosen as number) + difference * fixes[0].sign
    fixes[0].flags.add('corregido')
    return 'cuadra'
  }
  markDoubtful()
  for (const entry of fixes) entry.flags.add('dudoso')
  return 'no_cuadra'
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
      if (amount && amount.cents > 0) return amount.cents
    }
    return null
  }
  if (totalIndex !== null) {
    const fromReread = lastAmount(lines[totalIndex].reread)
    const fromText = lastAmount(lines[totalIndex].text)
    if (fromReread) addCandidate(votes, fromReread, 2)
    if (fromText) addCandidate(votes, fromText, 1.5)
  }
  for (const line of lines.slice(totalIndex ?? 0)) {
    if (/^\s*(IMPORTE|Lidl\s*Pay|TARJETA|Suma)\b/i.test(line.text)) {
      const value = lastAmount(line.text)
      if (value) addCandidate(votes, value, 1)
    }
  }
  return sorted(votes)[0]?.cents ?? null
}

// ---------------------------------------------------------------------------

/** Analiza las líneas leídas de una o varias capturas (o el texto pegado, una línea por renglón). */
export function parseTicket(pages: readonly (readonly OcrLine[])[]): ParsedTicket {
  const lines = mergePages(pages).filter((line) => line.text.trim() !== '')
  const store = detectStore(lines)

  const eurIndex = lines.findIndex((line) => /^\s*EUR\s*$/i.test(line.text))
  let start: number
  if (eurIndex !== -1) start = eurIndex + 1
  else {
    // Sin la cabecera «EUR»: desde la primera línea con nombre e importe.
    const first = lines.findIndex((line) => {
      const reading = readTail(tokensOf(cleanText(line.text)))
      return reading.amount !== null && letterCount(reading.nameTokens.join(' ')) >= 2 && !TOTAL_LINE.test(line.text)
    })
    start = first === -1 ? lines.length : first
  }
  const totalFound = lines.findIndex((line, i) => i >= start && TOTAL_LINE.test(line.text))
  const totalIndex = totalFound === -1 ? null : totalFound
  const end = totalIndex ?? lines.length

  const work: WorkLine[] = []
  for (let i = start; i < end; i++) {
    const line = lines[i]
    if (isSeparator(line.text) || HEADER_WORDS.test(line.text)) continue
    const previous = work[work.length - 1]
    const weight = readWeight(line)
    if (weight && /^\s*\d/.test(line.text)) {
      if (previous && previous.weightKg === null) {
        previous.weightKg = weight.weightKg
        previous.pricePerKgCents = weight.pricePerKgCents
        addCandidate(previous.amount, roundHalfUp(weight.weightKg * weight.pricePerKgCents), weight.agreed ? 3.5 : 2, false)
      }
      continue
    }
    if (DISCOUNT_LINE.test(line.text)) {
      if (previous) previous.discounts.push(readDiscount(line))
      continue
    }
    const item = readItemLine(line, work.length)
    if (item) {
      work.push(item)
      continue
    }
    // Un importe suelto en su propia línea: es del producto anterior si este no tenía.
    const tail = readTail(tokensOf(cleanText(line.text)))
    if (previous && previous.amount.length === 0 && tail.amount) addCandidate(previous.amount, tail.amount.cents, 1)
  }

  const entries: Entry[] = []
  for (const line of work) {
    entries.push({ line, slot: -1, sign: 1, candidates: line.amount, chosen: null, flags: new Set() })
    line.discounts.forEach((candidates, slot) => entries.push({ line, slot, sign: -1, candidates, chosen: null, flags: new Set() }))
  }
  const totalCents = readTotal(lines, totalIndex)
  solve(entries, totalCents)
  // Si se ha elegido un importe distinto del leído (calculado o corregido con el total), se avisa.
  for (const entry of entries) {
    const readBest = sorted(entry.candidates.filter((c) => c.read))[0]
    if (entry.chosen !== null && readBest && entry.chosen !== readBest.cents && !entry.flags.has('deducido')) entry.flags.add('corregido')
  }

  const parsed: ParsedTicketLine[] = work.map((line) => {
    const own = entries.filter((e) => e.line === line)
    const amountEntry = own.find((e) => e.slot === -1)!
    const flags = new Set<TicketLineFlag>()
    for (const entry of own) for (const flag of entry.flags) flags.add(flag)
    const amountCents = amountEntry.chosen
    return {
      position: line.position,
      rawName: line.rawName,
      key: nameKey(line.rawName),
      quantity: line.quantity,
      unitPriceCents: line.unitCents,
      amountCents,
      discountCents: own.filter((e) => e.slot >= 0).reduce((sum, e) => sum + (e.chosen ?? 0), 0),
      weightKg: line.weightKg,
      pricePerKgCents: line.pricePerKgCents,
      taxCode: line.taxCode,
      flags: [...flags],
    }
  })

  const { date, time } = dateAndTime(lines)
  return {
    store,
    storeName: storeNameOf(store, lines),
    address: addressOf(store, lines),
    date,
    time,
    totalCents,
    lines: parsed,
    check: checkTicket(parsed, totalCents),
  }
}

/** Suma de las líneas y si cuadra con el total. Sirve también tras editar importes en la revisión. */
export function checkTicket(
  lines: readonly Pick<ParsedTicketLine, 'amountCents' | 'discountCents'>[],
  totalCents: number | null,
): TicketCheck {
  const linesTotalCents = lines.reduce((sum, line) => sum + (line.amountCents ?? 0) - line.discountCents, 0)
  const unreadable = lines.filter((line) => line.amountCents === null).length
  const differenceCents = totalCents === null ? null : totalCents - linesTotalCents
  const status: TicketCheck['status'] =
    totalCents === null ? 'sin_total' : differenceCents === 0 && unreadable === 0 ? 'cuadra' : 'no_cuadra'
  return { status, linesTotalCents, differenceCents, unreadable }
}

/** Texto pegado (por ejemplo, de un ticket por email) como si fuera una captura. */
export function linesFromText(text: string): OcrLine[] {
  return text.split(/\r?\n/).map((line) => ({ text: line, reread: null }))
}
