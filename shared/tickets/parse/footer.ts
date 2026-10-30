import { roundRatio } from '../arithmetic.ts'
import type { OcrLine, TicketAdjustment } from '../types.ts'
import { type AmountToken, readAmountToken } from './amounts.ts'
import { cleanText, tokensOf } from './clean.ts'
import type { ParsedTicketLine, TaxCode, TaxGroupCheck, TicketCheck, TicketCheckStatus, TicketTaxGroup } from './types.ts'

/** Pie del ticket: desglose de IVA, medio de pago y comprobación con el total. */

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

export function paymentMethodOf(lines: readonly OcrLine[]): string | null {
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

