import { describe, expect, it } from 'vitest'
import { assessUnits, assessWeight, printedDigits, singleDigitEdit, singleEditVariants, type AmountReading } from './ticketEvidence.ts'

const reading = (cents: number, rawDigits = printedDigits(cents), malformed = false): AmountReading => ({ cents, rawDigits, malformed })
const one = (r: AmountReading) => ({ recognized: r, readings: [r], inputsStable: false, amountStable: false })

describe('errores de una cifra', () => {
  it.each([
    ['9290', '990', 'insercion'], // 92,90 por 9,90
    ['7920', '790', 'insercion'], // «7,920» por 7,90
    ['508', '568', 'sustitucion'], // 5,08 por 5,68
    ['99', '990', 'omision'],
    ['909', '990', 'transposicion'],
  ] as const)('%s frente a %s: %s', (read, expected, edit) => {
    expect(singleDigitEdit(read, expected)).toBe(edit)
  })
  it('más de un error, o ninguno, no es «un error de una cifra»', () => {
    expect(singleDigitEdit('464', '415')).toBeNull()
    expect(singleDigitEdit('990', '990')).toBeNull()
    expect(singleDigitEdit('9a0', '990')).toBeNull()
  })
  it('las variantes a un error incluyen cambiar, quitar, añadir e intercambiar, sin repetir el original', () => {
    const variants = singleEditVariants('495')
    expect(variants).toEqual(expect.arrayContaining(['485', '45', '4995', '459']))
    expect(variants).not.toContain('495')
    expect(new Set(variants).size).toBe(variants.length)
  })
  it('imprime las cifras como en el ticket', () => {
    expect(printedDigits(990)).toBe('990')
    expect(printedDigits(95)).toBe('095')
    expect(printedDigits(-178)).toBe('178')
  })
})

describe('precio × cantidad', () => {
  it('coherente: no hay discrepancia', () => {
    expect(assessUnits({ ...one(reading(990)), unitCents: 495, quantity: 2 })).toBeNull()
  })
  it('92,90 con 4,95 × 2: una cifra de más en el importe y ninguna explicación por el precio → se propone 9,90', () => {
    const d = assessUnits({ ...one(reading(9290)), unitCents: 495, quantity: 2 })!
    expect(d).toMatchObject({ kind: 'units', verdict: 'calculation', recognizedCents: 9290, calculatedCents: 990 })
    expect(d.explanation).toContain('92,90')
    expect(d.explanation).toContain('9,90')
  })
  it('5,08 con 2,84 × 2: tanto 5,68 → 5,08 como 2,54 → 2,84 son un error de una cifra → ambiguo', () => {
    const d = assessUnits({ ...one(reading(508)), unitCents: 284, quantity: 2 })!
    expect(d.verdict).toBe('ambiguous')
    expect(d.reasons.join(' ')).toContain('2,54')
  })
  it('lo mismo con una segunda lectura independiente que da 5,68 → se propone 5,68', () => {
    const text = reading(508)
    const reread = reading(568)
    expect(assessUnits({ recognized: text, readings: [text, reread], inputsStable: true, amountStable: false, unitCents: 284, quantity: 2 })!.verdict).toBe('calculation')
  })
  it('lo mismo si el OCR confía mucho más en el precio que en el importe', () => {
    expect(assessUnits({ ...one(reading(508)), unitCents: 284, quantity: 2, confidence: { amount: 55, inputs: 93 } })!.verdict).toBe('calculation')
  })
  it('el importe inestable entre las dos pasadas y la multiplicación estable deciden a favor del cálculo', () => {
    const text = reading(792, '7920', true)
    const reread = reading(720)
    expect(assessUnits({ recognized: text, readings: [text, reread], inputsStable: true, amountStable: false, unitCents: 395, quantity: 2 })!.verdict).toBe('calculation')
  })
  it('un precio unitario mal leído no se arregla para cuadrar: 9,90 con 4,35 × 2 favorece la lectura del importe', () => {
    // 4,35 → 4,95 es un error de una cifra; 8,70 → 9,90 serían dos.
    const d = assessUnits({ ...one(reading(990)), unitCents: 435, quantity: 2 })!
    expect(d.verdict).toBe('read')
    expect(d.reasons.join(' ')).toContain('4,95')
  })
  it('una cantidad mal leída también es una explicación alternativa', () => {
    // 14,85 = 4,95 × 3: puede que la cantidad «2» sea un «3».
    const d = assessUnits({ ...one(reading(1485)), unitCents: 495, quantity: 2 })!
    expect(d.verdict).toBe('read')
    expect(d.reasons.join(' ')).toContain('cantidad de 3')
  })
  it('si harían falta varios errores en cada lado, no decide', () => {
    expect(assessUnits({ ...one(reading(1234)), unitCents: 495, quantity: 2 })!.verdict).toBe('ambiguous')
  })
  it('una devolución conserva el signo', () => {
    expect(assessUnits({ ...one(reading(-178)), unitCents: 89, quantity: 2 })).toBeNull()
  })
})

describe('peso × precio por kilo', () => {
  it('0,544 kg × 6,75 = 3,67 (redondeo al céntimo, sin coma flotante)', () => {
    expect(assessWeight({ ...one(reading(367)), grams: 544, pricePerKgCents: 675 })).toBeNull()
  })
  it('3,76 con 0,544 × 6,75: dos cifras intercambiadas en el importe → se propone 3,67', () => {
    expect(assessWeight({ ...one(reading(376)), grams: 544, pricePerKgCents: 675 })).toMatchObject({ kind: 'weight', verdict: 'calculation', calculatedCents: 367 })
  })
  it('4,64 con 0,547 × 7,58: varios errores a cada lado y las dos líneas leídas igual → ambiguo', () => {
    expect(assessWeight({ ...one(reading(464)), grams: 547, pricePerKgCents: 758, inputsStable: true })!.verdict).toBe('ambiguous')
  })
})
