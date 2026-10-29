import { describeQuantity } from '../../domain/pantry.ts'
import { agoText, durationText, type ItemRhythm } from '../../domain/pantryRhythm.ts'

/** ¿Hay algo que decir de su ritmo? «Comprado hace 5 días» ya dice que está al día. */
export const showsRhythmStatus = (rhythm: ItemRhythm | undefined) =>
  rhythm !== undefined && rhythm.status !== 'al_dia' && rhythm.status !== 'sin_compras'

/** «Comprado hace 6 días en Lidl (1,1 kg) · suele durar unos 7 días». */
export function purchaseText(rhythm: ItemRhythm | undefined): string {
  if (!rhythm?.lastPurchase || rhythm.sinceDays === null) return 'Sin compras apuntadas todavía'
  const last = rhythm.lastPurchase
  const amount =
    last.amount !== null && last.measure === 'kg'
      ? ` (${describeQuantity(last.amount, 'kg')})`
      : last.amount !== null && last.amount > 1
        ? ` (${last.amount} ud)`
        : ''
  const when = rhythm.sinceDays === 0 ? 'Comprado hoy' : rhythm.sinceDays === 1 ? 'Comprado ayer' : `Comprado ${agoText(rhythm.sinceDays)}`
  return `${when}${last.store ? ` en ${last.store}` : ''}${amount}${rhythm.learned ? ` · suele durar ${durationText(rhythm.expectedDays)}` : ''}`
}
