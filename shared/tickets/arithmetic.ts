import type { TicketSaveLine } from './types.ts'

/** Integer rounding, ties away from zero, also for returns. */
export function roundRatio(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) throw new Error('Cálculo monetario no válido')
  return Math.sign(numerator) * Math.floor((Math.abs(numerator) + Math.floor(denominator / 2)) / denominator)
}

export function calculatedAmount(line: Pick<TicketSaveLine, 'weightKg' | 'pricePerKgCents' | 'quantity' | 'unitPriceCents' | 'amountCents'>): number | null {
  const sign = line.amountCents !== null && line.amountCents < 0 ? -1 : 1
  if (line.weightKg !== null && line.pricePerKgCents !== null) {
    return sign * roundRatio(Math.round(line.weightKg * 1000) * line.pricePerKgCents, 1000)
  }
  return line.unitPriceCents === null ? null : sign * line.quantity * line.unitPriceCents
}

/** Independent of OCR flags, shared by server and review. */
export function lineProblems(line: TicketSaveLine): string[] {
  const problems: string[] = []
  if (line.amountCents === null) problems.push('Falta el importe')
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 999) problems.push('Cantidad no válida')
  if (line.weightKg !== null && (!Number.isFinite(line.weightKg) || Math.round(line.weightKg * 1000) < 1)) problems.push('Peso no válido')
  const calculated = calculatedAmount(line)
  if (calculated !== null && line.amountCents !== null && calculated !== line.amountCents) problems.push('El importe no coincide con cantidad o peso × precio')
  if (line.amountCents !== null && line.discountCents > Math.max(0, line.amountCents)) problems.push('Descuento mayor que el importe')
  return problems
}

export function canApplyLine(line: TicketSaveLine): boolean {
  if (line.amountCents === null || line.amountCents < 0 || line.reviewStatus === 'pending') return false
  const problems = lineProblems(line)
  return problems.length === 0 && (line.confirmed === true || (line.evidence?.issues.length ?? 0) === 0)
}
