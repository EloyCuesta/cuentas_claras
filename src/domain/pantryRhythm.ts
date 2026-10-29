import { addDays, daysBetween } from './dates.ts'
import type { ISODate, PantryActivity, PantryEvent, PantryEventKind, PantryFrequency, PantryItem, PantryPurchase } from './types.ts'

/**
 * Ritmo de compra de cada producto: en lugar de contar lo que hay en la
 * despensa, la app recuerda cuándo se compró cada cosa y cada cuánto se suele
 * comprar, y avisa de lo que conviene mirar.
 *
 * - Cada compra abre un «ciclo» que termina en la siguiente compra o cuando se
 *   pulsa «Se acabó». La duración típica es la mediana de los últimos ciclos
 *   (una compra rara no la estropea).
 * - Si se conoce cuánto se compró (kilos o unidades) en las mismas medidas, la
 *   duración se escala con la cantidad: si 2 l duran 7 días, 4 l duran 14.
 * - «Queda» dice que el producto duró al menos hasta ese día (y pospone el
 *   aviso); «Se acabó» marca el final del ciclo. «Queda poco» lo pone en la
 *   lista de la compra, pero para aprender cuenta como «Queda»: todavía no se
 *   había acabado.
 * - Sin compras anteriores se usa la frecuencia del producto: 7, 30 o 121 días
 *   (121 días ≈ 0,25 veces al mes, como en la estimación mensual).
 *
 * Funciones puras: la fecha de hoy se recibe como parámetro.
 */

export type RhythmStatus = 'sin_compras' | 'al_dia' | 'revisar' | 'probablemente_acabado' | 'queda_poco' | 'se_acabo'

/** «Queda» y «Queda poco»: el producto seguía ahí ese día. */
const STILL_THERE: ReadonlySet<PantryEventKind> = new Set(['queda', 'poco'])

export const FALLBACK_DAYS: Record<PantryFrequency, number> = { semanal: 7, mensual: 30, ocasional: 121 }

const MAX_CYCLES = 6
const MAX_DAYS = 365

export interface ItemRhythm {
  status: RhythmStatus
  lastPurchase: PantryPurchase | null
  /** Lo que costó la última compra con precio conocido. */
  lastCostCents: number | null
  /** Cuánto suele durar una compra (días). */
  expectedDays: number
  /** true si se ha calculado con compras reales (no con la frecuencia). */
  learned: boolean
  /** A partir de qué día se da por probablemente acabado. */
  dueDate: ISODate | null
  /** Días desde la última compra. */
  sinceDays: number | null
}

/** Orden de lo que pasó: fecha y, el mismo día, el momento en que se apuntó. */
const byTime = (a: { date: ISODate; at: string }, b: { date: ISODate; at: string }) =>
  a.date.localeCompare(b.date) || a.at.localeCompare(b.at)
const after = (x: { date: ISODate; at: string }, y: { date: ISODate; at: string }) => byTime(x, y) > 0

function median(values: readonly number[]): number {
  const list = [...values].sort((a, b) => a - b)
  const middle = Math.floor(list.length / 2)
  return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2
}

interface Buy {
  date: ISODate
  at: string
  amount: number | null
  measure: 'kg' | 'ud' | null
  purchase: PantryPurchase
}

/** Junta las compras del mismo día (varias líneas del mismo producto, o un ticket y «Lo he comprado»). */
function mergeByDay(purchases: readonly PantryPurchase[]): Buy[] {
  const days = new Map<ISODate, PantryPurchase[]>()
  for (const purchase of purchases) days.set(purchase.date, [...(days.get(purchase.date) ?? []), purchase])
  return [...days.entries()]
    .map(([date, list]) => {
      const withAmount = list.filter((p) => p.amount !== null && p.measure !== null)
      const sameMeasure = withAmount.length > 0 && withAmount.every((p) => p.measure === withAmount[0].measure)
      const costs = list.filter((p) => p.costCents !== null)
      const latest = [...list].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)).at(-1)!
      const merged: PantryPurchase = {
        ...latest,
        // Redondeado a milésimas: 0,5 + 0,6 kg son 1,1 kg, sin restos binarios.
        amount: sameMeasure ? Math.round(withAmount.reduce((sum, p) => sum + (p.amount as number), 0) * 1000) / 1000 : null,
        measure: sameMeasure ? withAmount[0].measure : null,
        costCents: costs.length > 0 ? costs.reduce((sum, p) => sum + (p.costCents as number), 0) : null,
        store: [...list].reverse().find((p) => p.store)?.store ?? null,
        ticketId: [...list].reverse().find((p) => p.ticketId)?.ticketId ?? null,
      }
      return { date, at: latest.recordedAt, amount: merged.amount, measure: merged.measure, purchase: merged }
    })
    .sort(byTime)
}

export function itemRhythm(
  item: Pick<PantryItem, 'frequency'>,
  purchases: readonly PantryPurchase[],
  events: readonly PantryEvent[],
  today: ISODate,
): ItemRhythm {
  const fallback = FALLBACK_DAYS[item.frequency]
  // «Lo he comprado» cuenta como una compra sin cantidad ni precio.
  const manual: PantryPurchase[] = events
    .filter((e) => e.kind === 'comprado')
    .map((e) => ({ itemId: e.itemId, date: e.date, amount: null, measure: null, costCents: null, store: null, ticketId: null, recordedAt: e.createdAt }))
  const buys = mergeByDay([...purchases, ...manual])
  const marks = events
    .filter((e) => e.kind !== 'comprado')
    .map((e) => ({ date: e.date, at: e.createdAt, kind: e.kind }))
    .sort(byTime)

  const lastCostCents = [...buys].reverse().find((b) => b.purchase.costCents !== null)?.purchase.costCents ?? null

  if (buys.length === 0) {
    const latest = marks.at(-1)
    return {
      status: latest?.kind === 'se_acabo' ? 'se_acabo' : latest?.kind === 'poco' ? 'queda_poco' : 'sin_compras',
      lastPurchase: null,
      lastCostCents,
      expectedDays: fallback,
      learned: false,
      dueDate: null,
      sinceDays: null,
    }
  }

  // Duración de cada ciclo cerrado.
  const cycles: { days: number; amount: number | null; measure: 'kg' | 'ud' | null }[] = []
  buys.forEach((buy, i) => {
    const next = buys[i + 1]
    const inCycle = marks.filter((m) => after(m, buy) && (!next || !after(m, next)))
    const out = inCycle.find((m) => m.kind === 'se_acabo')
    const stillThere = inCycle.filter((m) => STILL_THERE.has(m.kind)).at(-1)
    let days: number | null = out ? daysBetween(buy.date, out.date) : next ? daysBetween(buy.date, next.date) : null
    if (days === null) return
    if (stillThere) days = Math.max(days, daysBetween(buy.date, stillThere.date))
    if (days >= 1) cycles.push({ days, amount: buy.amount, measure: buy.measure })
  })
  const recent = cycles.slice(-MAX_CYCLES)

  const last = buys[buys.length - 1]
  let expected = fallback
  const rates = recent.filter((c) => c.amount !== null && c.amount > 0 && c.measure === last.measure).map((c) => c.days / (c.amount as number))
  if (last.amount !== null && last.amount > 0 && rates.length >= 2) expected = median(rates) * last.amount
  else if (recent.length > 0) expected = median(recent.map((c) => c.days))
  const expectedDays = Math.min(MAX_DAYS, Math.max(1, Math.round(expected)))

  // Ciclo abierto: el de la última compra. Manda la última revisión.
  const sinceLast = marks.filter((m) => after(m, last))
  const latest = sinceLast.at(-1)
  const lastStill = sinceLast.filter((m) => STILL_THERE.has(m.kind)).at(-1)
  let dueDate = addDays(last.date, expectedDays)
  if (lastStill) {
    const postponed = addDays(lastStill.date, Math.max(2, Math.ceil(expectedDays * 0.3)))
    if (postponed > dueDate) dueDate = postponed
  }

  let status: RhythmStatus
  if (latest?.kind === 'se_acabo') status = 'se_acabo'
  else if (latest?.kind === 'poco') status = 'queda_poco'
  else if (today >= dueDate) status = 'probablemente_acabado'
  else if (today >= addDays(dueDate, -Math.max(1, Math.round(expectedDays * 0.15)))) status = 'revisar'
  else status = 'al_dia'

  return {
    status,
    lastPurchase: last.purchase,
    lastCostCents,
    expectedDays,
    learned: recent.length > 0,
    dueDate,
    sinceDays: daysBetween(last.date, today),
  }
}

/** El ritmo de todos los productos que se siguen por compras. */
export function rhythmsFor(
  items: readonly Pick<PantryItem, 'id' | 'frequency' | 'tracking'>[],
  activity: PantryActivity,
  today: ISODate,
): Map<string, ItemRhythm> {
  const purchases = new Map<string, PantryPurchase[]>()
  for (const purchase of activity.purchases) purchases.set(purchase.itemId, [...(purchases.get(purchase.itemId) ?? []), purchase])
  const events = new Map<string, PantryEvent[]>()
  for (const event of activity.events) events.set(event.itemId, [...(events.get(event.itemId) ?? []), event])
  const result = new Map<string, ItemRhythm>()
  for (const item of items) {
    if (item.tracking !== 'compras') continue
    result.set(item.id, itemRhythm(item, purchases.get(item.id) ?? [], events.get(item.id) ?? [], today))
  }
  return result
}

/** Lo que hay que mirar: ¿queda o se acabó? */
export const needsReview = (rhythm: ItemRhythm | undefined) => rhythm?.status === 'revisar' || rhythm?.status === 'probablemente_acabado'

// ---------------------------------------------------------------------------
// Textos

/** «hoy», «ayer», «hace 6 días», «hace 3 semanas»… */
export function agoText(days: number): string {
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 14) return `hace ${days} días`
  if (days < 60) return `hace ${Math.round(days / 7)} semanas`
  return `hace ${Math.round(days / 30)} meses`
}

/** «unos 7 días», «unas 2 semanas», «unos 3 meses». */
export function durationText(days: number): string {
  if (days === 1) return '1 día'
  if (days < 14) return `unos ${days} días`
  if (days < 60) return `unas ${Math.round(days / 7)} semanas`
  return `unos ${Math.round(days / 30)} meses`
}

export const RHYTHM_LABELS: Record<RhythmStatus, string> = {
  sin_compras: 'Sin compras apuntadas',
  al_dia: 'Al día',
  revisar: 'Revisar pronto',
  probablemente_acabado: 'Probablemente se acabó',
  queda_poco: 'Queda poco',
  se_acabo: 'Se acabó',
}
