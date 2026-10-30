import { formatEuros } from '../../core/money.ts'
import { roundRatio } from '../arithmetic.ts'
import { assessUnits, assessWeight, printedDigits, type AmountReading } from '../evidence.ts'
import { nameKey } from '../text.ts'
import type { TicketAmountOption, TicketDiscrepancy, TicketEvidence } from '../types.ts'
import type { AmountToken, Candidate } from './amounts.ts'
import { cleanText } from './clean.ts'
import type { WorkLine } from './lines.ts'
import type { ParsedTicketLine, TicketLineFlag } from './types.ts'

/** Selección local del importe de cada línea: el total nunca modifica un dato de producto. */

export const sorted = (candidates: readonly Candidate[]) => [...candidates].sort((a, b) => b.score - a.score || a.cents - b.cents)

const asReading = (token: AmountToken): AmountReading => ({ cents: token.cents, rawDigits: token.rawDigits, malformed: !token.clean,
  printed: `${token.cents < 0 ? '-' : ''}${token.rawDigits.slice(0, -2 - token.glued.replace(/\D/g, '').length)},${token.rawDigits.slice(-2 - token.glued.replace(/\D/g, '').length)}` })

export function selectLine(line: WorkLine): ParsedTicketLine {
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
