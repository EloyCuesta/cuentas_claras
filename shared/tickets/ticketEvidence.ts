import { formatEuros } from '../common/money.ts'
import { roundRatio } from './ticketArithmetic.ts'
import type { TicketDiscrepancy } from './types.ts'

/**
 * Evidencia para decidir qué cifra está mal leída cuando el importe de una
 * línea no coincide con su multiplicación (precio × cantidad o peso × precio
 * por kilo).
 *
 * La pregunta no es «¿qué importe hace cuadrar el ticket?», sino «¿qué campo
 * de esta línea tiene un error de lectura?». Un OCR suele equivocarse en UNA
 * cifra: la añade («9,90» → «92,90»), la pierde, la cambia por otra parecida
 * («5,68» → «5,08») o intercambia dos. Así que se comprueba:
 *
 * 1. Si un único error en el importe explica la cifra leída a partir del cálculo.
 * 2. Si un único error en el precio, la cantidad, el peso o el precio por kilo
 *    explicaría la cifra leída (la explicación alternativa).
 * 3. Qué campo es inestable entre las dos lecturas del OCR y cuál se leyó igual.
 * 4. Si hay una lectura independiente que dé exactamente el cálculo.
 * 5. La confianza que da Tesseract a cada palabra, cuando se conoce.
 *
 * Si solo una de las dos explicaciones es posible, hay evidencia. Si lo son las
 * dos y nada más las distingue, el caso es ambiguo y decide una persona. El
 * total del ticket nunca interviene: dos errores pueden compensarse.
 *
 * Funciones puras, con céntimos enteros.
 */

export type DigitEdit = 'insercion' | 'omision' | 'sustitucion' | 'transposicion'

const EDIT_TEXT: Record<DigitEdit, string> = {
  insercion: 'una cifra de más',
  omision: 'una cifra de menos',
  sustitucion: 'una cifra cambiada',
  transposicion: 'dos cifras intercambiadas',
}

/** El único error de una cifra que convierte `expected` en `read`; null si son iguales o hace falta más de uno. */
export function singleDigitEdit(read: string, expected: string): DigitEdit | null {
  if (read === expected || !/^\d+$/.test(read) || !/^\d+$/.test(expected)) return null
  if (read.length === expected.length + 1) {
    for (let i = 0; i < read.length; i++) if (read.slice(0, i) + read.slice(i + 1) === expected) return 'insercion'
    return null
  }
  if (read.length + 1 === expected.length) return singleDigitEdit(expected, read) === 'insercion' ? 'omision' : null
  if (read.length !== expected.length) return null
  const diff: number[] = []
  for (let i = 0; i < read.length; i++) if (read[i] !== expected[i]) diff.push(i)
  if (diff.length === 1) return 'sustitucion'
  if (diff.length === 2 && diff[1] === diff[0] + 1 && read[diff[0]] === expected[diff[1]] && read[diff[1]] === expected[diff[0]]) return 'transposicion'
  return null
}

/** Todas las cadenas de cifras a un solo error de `digits` (cambiar, quitar, añadir o intercambiar una cifra). */
export function singleEditVariants(digits: string): string[] {
  const out = new Set<string>()
  for (let i = 0; i <= digits.length; i++) {
    for (const d of '0123456789') {
      out.add(digits.slice(0, i) + d + digits.slice(i)) // añadir
      if (i < digits.length) out.add(digits.slice(0, i) + d + digits.slice(i + 1)) // cambiar
    }
    if (i < digits.length) out.add(digits.slice(0, i) + digits.slice(i + 1)) // quitar
    if (i + 1 < digits.length) out.add(digits.slice(0, i) + digits[i + 1] + digits[i] + digits.slice(i + 2)) // intercambiar
  }
  out.delete(digits)
  out.delete('')
  return [...out]
}

/** Cifras de un importe tal como se imprime: 990 → «990» (9,90); 95 → «095» (0,95). */
export const printedDigits = (cents: number) => `${Math.floor(Math.abs(cents) / 100)}${String(Math.abs(cents) % 100).padStart(2, '0')}`

/** Una lectura del importe con sus cifras en bruto (incluidas las que el OCR pegó detrás: «7,920» → «7920»). */
export interface AmountReading {
  cents: number
  rawDigits: string
  /** Tenía cifras pegadas o sobrantes: el campo se leyó mal con seguridad. */
  malformed: boolean
  /** Cómo se leyó, para enseñarlo tal cual («7,920»). */
  printed?: string
}

interface Confidence {
  amount?: number
  inputs?: number
}

interface Common {
  /** La lectura elegida (normal o relectura). */
  recognized: AmountReading
  /** Todas las lecturas del importe que hay (1 o 2). */
  readings: readonly AmountReading[]
  /** Las dos pasadas del OCR leyeron igual los datos de la multiplicación. */
  inputsStable: boolean
  /** Hay dos pasadas y leyeron el mismo importe. */
  amountStable: boolean
  confidence?: Confidence
}

const CONFIDENT = 85
const MARGIN = 15

function decide(calculatedCents: number, kind: TicketDiscrepancy['kind'], common: Common, alternative: string | null, operation: string): TicketDiscrepancy {
  const { recognized, readings } = common
  const calculatedDigits = printedDigits(calculatedCents)
  const edits = readings.map(r => singleDigitEdit(r.rawDigits, calculatedDigits))
  const edit = edits.find(e => e !== null) ?? null
  // `recognized` difiere del cálculo, así que una lectura que lo iguala es la otra pasada del OCR.
  const independent = readings.some(r => r.cents === calculatedCents)
  const read = recognized.malformed && recognized.printed ? `«${recognized.printed}»` : formatEuros(recognized.cents)
  const calc = formatEuros(calculatedCents)
  const reasons: string[] = []
  const base = `El importe leído (${read}) no coincide con ${operation} = ${calc}.`
  const result = (verdict: TicketDiscrepancy['verdict'], explanation: string): TicketDiscrepancy =>
    ({ kind, verdict, recognizedCents: recognized.cents, calculatedCents, explanation: `${base} ${explanation}`, reasons })

  if (edit) reasons.push(`Un error de lectura en el importe (${EDIT_TEXT[edit]}) explica ${read} a partir de ${calc}.`)
  if (alternative) reasons.push(alternative)

  if (independent) {
    reasons.push(`Otra lectura del OCR da exactamente ${calc}.`)
    return result('calculation', `Una segunda lectura del OCR da ${calc}: se propone ese importe.`)
  }
  if (edit && !alternative) {
    reasons.push(kind === 'units' ? 'Ningún error de una cifra en el precio o la cantidad daría la cifra leída.' :
      'Ningún error de una cifra en el peso o el precio por kilo daría la cifra leída.')
    return result('calculation', `Se explica por ${EDIT_TEXT[edit]} en el importe: se propone ${calc}.`)
  }
  if (!edit && alternative) {
    return result('read', `Un error en ${kind === 'units' ? 'el precio o la cantidad' : 'el peso o el precio por kilo'} lo explica mejor que uno en el importe: revisa esos datos.`)
  }
  if (readings.length > 1 && !common.amountStable && common.inputsStable) {
    reasons.push('Las dos lecturas del OCR coinciden en la multiplicación y discrepan en el importe.')
    if (edit) return result('calculation', `El importe es la cifra inestable y ${EDIT_TEXT[edit]} lo explica: se propone ${calc}.`)
  }
  if (readings.length > 1 && common.amountStable && !common.inputsStable && alternative) {
    reasons.push('Las dos lecturas del OCR coinciden en el importe y discrepan en la multiplicación.')
    return result('read', 'Los datos de la multiplicación son la cifra inestable: revísalos.')
  }
  if (edit && recognized.malformed) {
    reasons.push('El importe leído tiene cifras sobrantes pegadas.')
    return result('calculation', `El importe leído está deformado y ${EDIT_TEXT[edit]} lo explica: se propone ${calc}.`)
  }
  const { amount, inputs } = common.confidence ?? {}
  if (amount !== undefined && inputs !== undefined) {
    if (inputs >= CONFIDENT && amount <= inputs - MARGIN) {
      reasons.push(`El OCR confía más en la multiplicación (${Math.round(inputs)} %) que en el importe (${Math.round(amount)} %).`)
      if (edit) return result('calculation', `La lectura del importe es la menos fiable: se propone ${calc}.`)
    }
    if (amount >= CONFIDENT && inputs <= amount - MARGIN) {
      reasons.push(`El OCR confía más en el importe (${Math.round(amount)} %) que en la multiplicación (${Math.round(inputs)} %).`)
      if (alternative) return result('read', 'La lectura de la multiplicación es la menos fiable: revísala.')
    }
  }
  return result('ambiguous', edit && alternative
    ? 'Tanto un error en el importe como uno en la multiplicación lo explican, y nada en el ticket permite saber cuál: elige tú el importe correcto.'
    : 'Harían falta varios errores de lectura para explicarlo: comprueba la línea en la imagen.')
}

/** Precio × cantidad. null si la línea es coherente o no hay datos para calcular. */
export function assessUnits(input: Common & { unitCents: number; quantity: number }): TicketDiscrepancy | null {
  const { unitCents, quantity, recognized } = input
  const calculatedCents = Math.sign(recognized.cents || 1) * unitCents * quantity
  if (calculatedCents === recognized.cents) return null
  const target = Math.abs(recognized.cents)
  let alternative: string | null = null
  for (const variant of singleEditVariants(printedDigits(unitCents))) {
    if (Number(variant) * quantity === target) {
      alternative = `Un precio unitario de ${formatEuros(Number(variant))} en lugar de ${formatEuros(unitCents)} también daría ${formatEuros(target)}.`
      break
    }
  }
  if (!alternative) {
    for (const variant of singleEditVariants(String(quantity))) {
      const q = Number(variant)
      if (q >= 1 && q <= 999 && q * unitCents === target) {
        alternative = `Una cantidad de ${q} en lugar de ${quantity} también daría ${formatEuros(target)}.`
        break
      }
    }
  }
  return decide(calculatedCents, 'units', input, alternative, `${formatEuros(unitCents)} × ${quantity}`)
}

const gramsText = (grams: number) => `${(grams / 1000).toFixed(3).replace('.', ',')} kg`

/** Peso × precio por kilo, redondeado al céntimo. null si la línea es coherente. */
export function assessWeight(input: Common & { grams: number; pricePerKgCents: number }): TicketDiscrepancy | null {
  const { grams, pricePerKgCents, recognized } = input
  const sign = recognized.cents < 0 ? -1 : 1
  const calculatedCents = sign * roundRatio(grams * pricePerKgCents, 1000)
  if (calculatedCents === recognized.cents) return null
  const target = Math.abs(recognized.cents)
  let alternative: string | null = null
  for (const variant of singleEditVariants(String(grams).padStart(4, '0'))) {
    const g = Number(variant)
    if (g >= 1 && g <= 1_000_000 && roundRatio(g * pricePerKgCents, 1000) === target) {
      alternative = `Un peso de ${gramsText(g)} en lugar de ${gramsText(grams)} también daría ${formatEuros(target)}.`
      break
    }
  }
  if (!alternative) {
    for (const variant of singleEditVariants(printedDigits(pricePerKgCents))) {
      if (roundRatio(grams * Number(variant), 1000) === target) {
        alternative = `Un precio de ${formatEuros(Number(variant))}/kg en lugar de ${formatEuros(pricePerKgCents)}/kg también daría ${formatEuros(target)}.`
        break
      }
    }
  }
  return decide(calculatedCents, 'weight', input, alternative, `${gramsText(grams)} × ${formatEuros(pricePerKgCents)}/kg`)
}
