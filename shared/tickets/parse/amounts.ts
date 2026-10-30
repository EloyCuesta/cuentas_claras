import type { TaxCode } from './types.ts'

/** Lectura de importes: tokens de cifras, cantidades y letras del IVA. */

export interface Candidate {
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
export const QTY_TOKEN = /^\d{1,3}$/
const LOOSE_AMOUNT_TOKEN = /^(\d{3,4})\D?$/

export const toCents = (integer: string, decimals: string) => Number(integer) * 100 + Number(decimals)

export interface AmountToken {
  cents: number
  /** Sin nada pegado detrás salvo, como mucho, la letra del IVA. */
  clean: boolean
  glued: string
  /** Cifras tal como se leyeron, incluidas las pegadas detrás («7,920» → «7920»). */
  rawDigits: string
}

export function readAmountToken(token: string): AmountToken | null {
  const match = AMOUNT_TOKEN.exec(token)
  if (!match) return null
  const value = toCents(match[2], match[3])
  const glued = match[4]
  return { cents: match[1] ? -value : value, clean: glued === '' || /^[A-Za-z€¢(]$/.test(glued), glued,
    rawDigits: `${match[2]}${match[3]}${glued.replace(/\D/g, '')}` }
}

export const isTaxToken = (token: string) => token.length <= 2 && !/\d[,.]/.test(token) && TAX_MAP[token[0]] !== undefined

export interface TailReading {
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
export function readTail(allTokens: readonly string[]): TailReading {
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
