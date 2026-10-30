import type { OcrLine } from '../types.ts'
import {
  type AmountToken,
  type Candidate,
  isTaxToken,
  QTY_TOKEN,
  readAmountToken,
  readTail,
  type TailReading,
  toCents,
} from './amounts.ts'
import { cleanText, firstGapTokenIndex, hasLookalikeDigits, letterCount, tokensOf, WEIGHT_LINE } from './clean.ts'
import type { TaxCode } from './types.ts'

/** Productos: cada línea con sus importes candidatos, pesos y descuentos. */

export interface WorkLine {
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

export function addCandidate(list: Candidate[], cents: number, score: number, read = true): void {
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

export function readWeight(line: OcrLine): { weightKg: number; pricePerKgCents: number; agreed: boolean; confidence?: number } | null {
  const reads = [line.reread, line.text].flatMap((text) => {
    const match = text ? WEIGHT_LINE.exec(text) : null
    return match ? [{ weightKg: Number(`${match[1]}.${match[2]}`), pricePerKgCents: toCents(match[3], match[4]) }] : []
  })
  if (reads.length === 0) return null
  const agreed = reads.length === 2 && reads[0].weightKg === reads[1].weightKg && reads[0].pricePerKgCents === reads[1].pricePerKgCents
  const confidence = minConfidence((line.words ?? []).filter(w => /\d/.test(w.text)).map(w => w.confidence))
  return { ...reads[0], agreed, confidence }
}

export function readItemLine(line: OcrLine, position: number): WorkLine | null {
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

export function readDiscount(line: OcrLine): Candidate[] {
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
