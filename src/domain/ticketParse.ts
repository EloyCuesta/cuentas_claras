import { isValidISODate, toISODate } from './dates.ts'
import { nameKey, similarity } from './ticketText.ts'
import { calculatedAmount, roundRatio } from './ticketArithmetic.ts'
import type { ISODate, OcrLine, TicketAdjustment, TicketEvidence } from './types.ts'

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
  evidence?: TicketEvidence
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
  adjustments: TicketAdjustment[]
  issues: string[]
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
    .replace(/[−–](?=\s*\d)/g, '-')
    .replace(/\b[0-9OISB]+[,.:;][0-9OISB]{2}(?=[ABC]?\b)/g, token => token.replace(/[OISB]/g, c => ({ O: '0', I: '1', S: '5', B: '8' })[c]!))
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
  amount: Candidate[]
  discounts: Candidate[][]
  source: OcrLine
  issues: string[]
}

function addCandidate(list: Candidate[], cents: number, score: number, read = true): void {
  const existing = list.find((c) => c.cents === cents)
  if (existing) {
    existing.score += score
    existing.read ||= read
  } else list.push({ cents, score, read })
}

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
    source: line,
    issues: [],
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

function selectLine(line: WorkLine): ParsedTicketLine {
  const reads = sorted(line.amount.filter(c => c.read))
  const primary = readTail(tokensOf(cleanText(line.source.text))).amount?.cents ?? null
  const secondary = line.source.reread ? readTail(tokensOf(cleanText(line.source.reread))).amount?.cents ?? null : null
  const read = reads[0]?.cents ?? null
  const calculated = calculatedAmount({ quantity: line.quantity, unitPriceCents: line.unitCents,
    weightKg: line.weightKg, pricePerKgCents: line.pricePerKgCents, amountCents: read })
  const flags = new Set<TicketLineFlag>()
  const issues = [...line.issues]
  let amount = read
  let selectedBy: TicketEvidence['selectedBy'] = secondary !== null && read === secondary ? 'reread' : 'read'
  // Arithmetic is evidence only when its independent OCR readings agreed.
  const arithmetic = line.amount.find(c => !c.read && c.score >= 3.5)
  if (arithmetic && arithmetic.cents !== read) {
    amount = arithmetic.cents
    selectedBy = 'calculation'
    flags.add('corregido')
    issues.push('Importe corregido mediante cantidad o peso; confirma la lectura')
  }
  if (amount === null) { flags.add('ilegible'); issues.push('No se lee el importe') }
  if (reads.length > 1 && !arithmetic) issues.push('Las lecturas del importe no coinciden')
  if (calculated !== null && amount !== null && calculated !== amount) issues.push('El importe no coincide con cantidad o peso × precio')
  if ((line.source.confidence ?? 100) < 75) issues.push('Lectura de baja confianza')
  if (/[0-9OISB]+[,.:;][0-9OISB]{2}/.test(line.source.text) &&
      /[OISB]/.test(line.source.text.match(/[0-9OISB]+[,.:;][0-9OISB]{2}/)?.[0] ?? '')) issues.push('Se han interpretado letras como cifras')
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
    evidence: { text: line.source.text, reread: line.source.reread, recognizedCents: primary,
      calculatedCents: calculated, selectedBy, issues: [...new Set(issues)], source: line.source.source } }
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
      const tail = readTail(tokensOf(cleanText(line.text)))
      if (tail.amount === null || letterCount(tail.nameTokens.join(' ')) < 2 || DISCOUNT_LINE.test(line.text) || TOTAL_LINE.test(line.text)) continue
      state = 'products'
    }
    const previous = work[work.length - 1]
    const weight = readWeight(line)
    if (weight && /^\s*\d/.test(line.text)) {
      if (previous && previousWasItem && previous.weightKg === null) {
        previous.weightKg = weight.weightKg
        previous.pricePerKgCents = weight.pricePerKgCents
        const sign = sorted(previous.amount)[0]?.cents < 0 ? -1 : 1
        addCandidate(previous.amount, sign * roundRatio(Math.round(weight.weightKg * 1000) * weight.pricePerKgCents, 1000), weight.agreed ? 3.5 : 2, false)
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
  const check = checkTicket(parsed, totalCents, adjustments)
  if (check.status === 'no_cuadra') issues.push('Los importes no cuadran con el total')
  for (let p = 1; p < pages.length; p++) {
    const previous = pages[p - 1]
    const next = pages[p]
    if (previous.length && next.length && !next[0].source && nameKey(previous.at(-1)!.text) === nameKey(next[0].text)) {
      if (nameKey(next[0].text) === nameKey(next[1]?.text ?? '')) issues.push('Solapamiento ambiguo: se han conservado los productos repetidos')
    }
  }
  const paymentTotals = metadata.filter(l => /^\s*(Lidl\s*Pay|IMPORTE:|TOTAL\b)/i.test(l.text))
    .map(l => readTotal([l], /^\s*TOTAL\b/i.test(l.text) ? 0 : null)).filter(n => n !== null)
  if (new Set(paymentTotals).size > 1) issues.push('Los totales de compra y pago no coinciden')
  const { date, time } = dateAndTime(metadata)
  if (!date) issues.push('No se ha reconocido la fecha de compra')
  return { store, storeName: storeNameOf(store, lines), address: addressOf(store, lines), date, time,
    totalCents, lines: parsed, adjustments, issues: [...new Set(issues)], check }
}
/** Suma de las líneas y si cuadra con el total. Sirve también tras editar importes en la revisión. */
export function checkTicket(
  lines: readonly Pick<ParsedTicketLine, 'amountCents' | 'discountCents'>[],
  totalCents: number | null,
  adjustments: readonly Pick<TicketAdjustment, 'amountCents'>[] = [],
): TicketCheck {
  const linesTotalCents = lines.reduce((sum, line) => sum + (line.amountCents ?? 0) - line.discountCents, 0) + adjustments.reduce((sum, a) => sum + (a.amountCents ?? 0), 0)
  const unreadable = lines.filter((line) => line.amountCents === null).length + adjustments.filter(a => a.amountCents === null).length
  const differenceCents = totalCents === null ? null : totalCents - linesTotalCents
  const status: TicketCheck['status'] =
    totalCents === null ? 'sin_total' : differenceCents === 0 && unreadable === 0 ? 'cuadra' : 'no_cuadra'
  return { status, linesTotalCents, differenceCents, unreadable }
}

/** Texto pegado (por ejemplo, de un ticket por email) como si fuera una captura. */
export function linesFromText(text: string): OcrLine[] {
  return text.split(/\r?\n/).map((line) => ({ text: line, reread: null }))
}
