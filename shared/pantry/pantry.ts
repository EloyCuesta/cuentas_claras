import { formatEuros } from '../core/money.ts'
import type { ISODate } from '../core/types.ts'
import { FALLBACK_DAYS, type ItemRhythm } from './rhythm.ts'
import type { PantryFrequency, PantryItem, PantryPerson, PantryTracking, PantryUnit } from './types.ts'

/**
 * Cálculos de la despensa: lo que falta, lo que cuesta y la lista de la compra.
 *
 * Funciones puras: no dependen de React, de SQLite ni del reloj (la fecha de la
 * lista se recibe como parámetro).
 *
 * Precisión: las cantidades admiten como mucho 3 decimales y se calculan como
 * enteros de milésimas, así 0,1 + 0,2 no deja restos ni «faltantes» ficticios.
 * Los importes se calculan con BigInt (exactos) y se redondean una sola vez por
 * línea al céntimo más cercano, con las mitades hacia arriba.
 */

export const PANTRY_UNITS: readonly PantryUnit[] = ['ud', 'g', 'kg', 'ml', 'l', 'paquete', 'lata', 'botella', 'bolsa', 'docena']
export const PANTRY_FREQUENCIES: readonly PantryFrequency[] = ['semanal', 'mensual', 'ocasional']

/** Unidades que admiten decimales; las demás se cuentan en números enteros. */
export const DECIMAL_UNITS: ReadonlySet<PantryUnit> = new Set(['g', 'kg', 'ml', 'l'])

export const QUANTITY_DECIMALS = 3
const MILLI = 1000
/** Cantidad máxima de un producto (un millón de gramos, botellas…). */
export const MAX_QUANTITY = 1_000_000
/** Precio y presupuesto máximos de la despensa: 100.000,00 €. */
export const MAX_PANTRY_CENTS = 10_000_000

export const PANTRY_NAME_MAX = 80
export const PERSON_NAME_MAX = 40
export const PANTRY_NOTES_MAX = 120

export const FREQUENCY_TITLES: Record<PantryFrequency, string> = {
  semanal: 'Cada semana',
  mensual: 'Cada mes',
  ocasional: 'De vez en cuando',
}

export const FREQUENCY_LABELS: Record<PantryFrequency, string> = {
  semanal: 'Semanal (casi todas las semanas)',
  mensual: 'Mensual (una vez al mes)',
  ocasional: 'Ocasional (de vez en cuando)',
}

/** Veces al mes que se compra el objetivo, en centésimas: 4,33 · 1 · 0,25. */
const MONTHLY_FACTOR_HUNDREDTHS: Record<PantryFrequency, bigint> = { semanal: 433n, mensual: 100n, ocasional: 25n }

export const isPantryUnit = (value: unknown): value is PantryUnit => PANTRY_UNITS.includes(value as PantryUnit)
export const isPantryFrequency = (value: unknown): value is PantryFrequency =>
  PANTRY_FREQUENCIES.includes(value as PantryFrequency)

// ---------------------------------------------------------------------------
// Cantidades

/** Cantidad en milésimas enteras, o null si no es una cantidad válida (negativa, enorme o con más de 3 decimales). */
export function toMilli(value: number): number | null {
  if (!Number.isFinite(value) || value < 0 || value > MAX_QUANTITY) return null
  const scaled = value * MILLI
  const rounded = Math.round(scaled)
  // Tolera los restos binarios (0,1 + 0,2), no un cuarto decimal de verdad.
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : null
}

const fromMilli = (milli: number) => milli / MILLI

export type QuantityCheck = { ok: true; value: number } | { ok: false; error: string }

/** Valida una cantidad para una unidad y la devuelve normalizada (sin restos binarios). Nunca redondea a escondidas. */
export function checkQuantity(value: unknown, unit: PantryUnit): QuantityCheck {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, error: 'Escribe una cantidad.' }
  if (value < 0) return { ok: false, error: 'La cantidad no puede ser negativa.' }
  if (value > MAX_QUANTITY) return { ok: false, error: 'La cantidad es demasiado grande.' }
  const milli = toMilli(value)
  if (milli === null) return { ok: false, error: `Usa como máximo ${QUANTITY_DECIMALS} decimales.` }
  if (!DECIMAL_UNITS.has(unit) && milli % MILLI !== 0) {
    return { ok: false, error: `En «${unitName(unit)}» la cantidad tiene que ser un número entero.` }
  }
  return { ok: true, value: fromMilli(milli) }
}

/** Lo que suma o resta cada pulsación de + y −. */
export function quantityStep(unit: PantryUnit): number {
  if (unit === 'g' || unit === 'ml') return 100
  if (unit === 'kg' || unit === 'l') return 0.5
  return 1
}

/** Cantidad tras pulsar + (delta > 0) o − (delta < 0). Restar nunca baja de cero. */
export function stepQuantity(quantity: number, delta: number): number {
  const current = toMilli(quantity) ?? 0
  const step = Math.round(delta * MILLI)
  return fromMilli(Math.max(0, current + step))
}

/** Lo que falta para llegar al objetivo (0 si hay de sobra). */
export function missingQuantity(item: Pick<PantryItem, 'quantity' | 'target'>): number {
  return fromMilli(missingMilli(item))
}

function missingMilli(item: Pick<PantryItem, 'quantity' | 'target'>): number {
  return Math.max(0, (toMilli(item.target) ?? 0) - (toMilli(item.quantity) ?? 0))
}

/** Lo que hay por encima del objetivo (0 si no sobra nada). */
export function excessQuantity(item: Pick<PantryItem, 'quantity' | 'target'>): number {
  return fromMilli(Math.max(0, (toMilli(item.quantity) ?? 0) - (toMilli(item.target) ?? 0)))
}

export const isMissing = (item: Pick<PantryItem, 'quantity' | 'target'>) => missingMilli(item) > 0

/** Ritmo de compra de los productos que se siguen por compras (ver rhythm.ts). */
export type Rhythms = ReadonlyMap<string, ItemRhythm>

const COUNT_UNITS: ReadonlySet<PantryUnit> = new Set(['ud', 'paquete', 'lata', 'botella', 'bolsa', 'docena'])

/**
 * Lo que cambia según cómo se sigue un producto (ver tracking.ts), en un
 * solo sitio: el resto de la app llama al modo del producto en vez de
 * preguntar cuál es.
 */
export interface TrackingMode {
  /** ¿Va a la lista de la compra? */
  needsBuying(item: Pick<PantryItem, 'quantity' | 'target'>, rhythm: ItemRhythm | undefined): boolean
  /** Cuánto comprar, en la unidad del producto. null = no se sabe. */
  listQuantity(item: Pick<PantryItem, 'quantity' | 'target' | 'unit'>, rhythm: ItemRhythm | undefined): number | null
  /** Lo que costará comprarlo. null = sin precio. */
  listCostCents(item: Pick<PantryItem, 'id' | 'quantity' | 'target' | 'unit' | 'priceCents'>, rhythm: ItemRhythm | undefined): number | null
  /** Gasto mensual estimado. null = sin precio. */
  monthlyCostCents(item: Pick<PantryItem, 'id' | 'target' | 'unit' | 'priceCents' | 'frequency'>, rhythm: ItemRhythm | undefined): number | null
}

const asRhythms = (item: Pick<PantryItem, 'id'>, rhythm: ItemRhythm | undefined): Rhythms => new Map(rhythm ? [[item.id, rhythm]] : [])

export const TRACKING_MODES: Readonly<Record<PantryTracking, TrackingMode>> = {
  cantidad: {
    needsBuying: (item) => isMissing(item),
    listQuantity: (item) => missingQuantity(item),
    listCostCents: (item) => missingCostCents(item),
    monthlyCostCents: (item) => monthlyCostCents(item),
  },
  compras: {
    needsBuying: (_item, rhythm) =>
      rhythm?.status === 'se_acabo' || rhythm?.status === 'queda_poco' || rhythm?.status === 'probablemente_acabado',
    listQuantity: (item, rhythm) => {
      const last = rhythm?.lastPurchase
      if (!last || last.amount === null) return null
      if (last.measure === 'kg' && item.unit === 'kg') return last.amount
      if (last.measure === 'kg' && item.unit === 'g') return Math.round(last.amount * 1000)
      if (last.measure === 'ud' && COUNT_UNITS.has(item.unit)) return last.amount
      return null
    },
    listCostCents: (item, rhythm) => purchaseCostCents(item, asRhythms(item, rhythm)),
    monthlyCostCents: (item, rhythm) => monthlyCostFromRhythm(item, asRhythms(item, rhythm)),
  },
}

/** El modo de seguimiento de un producto. */
export const trackingOf = (item: Pick<PantryItem, 'tracking'>): TrackingMode => TRACKING_MODES[item.tracking]

/**
 * ¿Hay que comprarlo? Si se cuenta, cuando hay menos de lo que se quiere tener;
 * si se sigue por compras, cuando se acabó, queda poco o probablemente se ha acabado.
 */
export function needsBuying(item: Pick<PantryItem, 'id' | 'tracking' | 'quantity' | 'target'>, rhythms?: Rhythms): boolean {
  return trackingOf(item).needsBuying(item, rhythms?.get(item.id))
}

/**
 * Cuánto comprar: lo que falta si se cuenta; si se sigue por compras, lo de la
 * última compra en la unidad del producto (si se puede saber).
 */
export function listQuantity(item: Pick<PantryItem, 'id' | 'tracking' | 'quantity' | 'target' | 'unit'>, rhythms?: Rhythms): number | null {
  return trackingOf(item).listQuantity(item, rhythms?.get(item.id))
}

/** Lo que costará comprarlo: lo que falta × precio, o lo que cuesta una compra (ver purchaseCostCents). */
export function listCostCents(
  item: Pick<PantryItem, 'id' | 'tracking' | 'quantity' | 'target' | 'unit' | 'priceCents'>,
  rhythms?: Rhythms,
): number | null {
  return trackingOf(item).listCostCents(item, rhythms?.get(item.id))
}

/**
 * Lo que cuesta una compra de un producto que se sigue por compras: la última
 * con precio conocido (de un ticket) o, mientras no haya ninguna, el precio
 * estimado de una unidad (un kilo o un litro en kg y l). En g y ml no se puede
 * saber cuánto se compra cada vez.
 */
export function purchaseCostCents(item: Pick<PantryItem, 'id' | 'unit' | 'priceCents'>, rhythms?: Rhythms): number | null {
  const last = rhythms?.get(item.id)?.lastCostCents
  if (last !== undefined && last !== null) return last
  if (item.priceCents === null || item.unit === 'g' || item.unit === 'ml') return null
  return item.priceCents
}

// ---------------------------------------------------------------------------
// Importes

/** En "g" y "ml" el precio es por kilo o por litro: se divide entre 1000 unidades. */
const priceDivisor = (unit: PantryUnit) => (unit === 'g' || unit === 'ml' ? 1000n : 1n)

/** num / den redondeado al entero más cercano, mitades hacia arriba (valores no negativos). */
function roundHalfUp(num: bigint, den: bigint): bigint {
  return (num * 2n + den) / (den * 2n)
}

function toSafeCents(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('El importe calculado es demasiado grande.')
  return Number(value)
}

/** Coste de lo que falta de un producto, en céntimos. null si no tiene precio. */
export function missingCostCents(item: Pick<PantryItem, 'quantity' | 'target' | 'unit' | 'priceCents'>): number | null {
  if (item.priceCents === null) return null
  return toSafeCents(roundHalfUp(BigInt(missingMilli(item)) * BigInt(item.priceCents), BigInt(MILLI) * priceDivisor(item.unit)))
}

/**
 * Gasto mensual estimado de un producto que se cuenta: objetivo × precio × veces
 * al mes. null si no tiene precio.
 */
export function monthlyCostCents(item: Pick<PantryItem, 'target' | 'unit' | 'priceCents' | 'frequency'>): number | null {
  if (item.priceCents === null) return null
  const target = BigInt(toMilli(item.target) ?? 0)
  const factor = MONTHLY_FACTOR_HUNDREDTHS[item.frequency]
  return toSafeCents(roundHalfUp(target * BigInt(item.priceCents) * factor, BigInt(MILLI) * priceDivisor(item.unit) * 100n))
}

/** Suma de importes conocidos. `withoutPrice` cuenta los productos que no tienen precio (resultado parcial). */
export interface KnownTotal {
  cents: number
  withoutPrice: number
}

function sumKnown(values: readonly (number | null)[]): KnownTotal {
  let cents = 0n
  let withoutPrice = 0
  for (const value of values) {
    if (value === null) withoutPrice++
    else cents += BigInt(value)
  }
  return { cents: toSafeCents(cents), withoutPrice }
}

// ---------------------------------------------------------------------------
// Filtros y resumen

/** «Compartido», «Todo» o el id de una persona. */
export type OwnerFilter = 'compartido' | 'todo' | { personId: string }

export function matchesOwner(item: Pick<PantryItem, 'ownerId'>, owner: OwnerFilter): boolean {
  if (owner === 'todo') return true
  if (owner === 'compartido') return item.ownerId === null
  return item.ownerId === owner.personId
}

export interface PantrySummary {
  /** Número de productos que faltan (no la suma de sus cantidades). */
  missingCount: number
  /** Coste de lo que falta; parcial si hay productos sin precio. */
  pendingCost: KnownTotal
}

export function pantrySummary(items: readonly PantryItem[], owner: OwnerFilter, rhythms?: Rhythms): PantrySummary {
  const missing = items.filter((item) => matchesOwner(item, owner) && needsBuying(item, rhythms))
  return { missingCount: missing.length, pendingCost: sumKnown(missing.map((item) => listCostCents(item, rhythms))) }
}

/**
 * Gasto mensual estimado de un producto que se sigue por compras: lo que cuesta
 * una compra × las veces que se compra al mes (30,31 días / lo que dura; con 7
 * días da 4,33, como en los semanales que se cuentan).
 */
export function monthlyCostFromRhythm(item: Pick<PantryItem, 'id' | 'unit' | 'priceCents' | 'frequency'>, rhythms?: Rhythms): number | null {
  const cost = purchaseCostCents(item, rhythms)
  if (cost === null) return null
  const days = rhythms?.get(item.id)?.expectedDays ?? FALLBACK_DAYS[item.frequency]
  return toSafeCents(roundHalfUp(BigInt(cost) * 3031n, 100n * BigInt(days)))
}

/** Gasto mensual estimado de toda la casa (todos los productos). */
export function monthlyEstimate(items: readonly PantryItem[], rhythms?: Rhythms): KnownTotal {
  return sumKnown(items.map((item) => trackingOf(item).monthlyCostCents(item, rhythms?.get(item.id))))
}

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id)

/** Personas ordenadas por nombre (orden estable). */
export function sortPeople(people: readonly PantryPerson[]): PantryPerson[] {
  return [...people].sort(byName)
}

/** Productos ordenados por frecuencia (semanal, mensual, ocasional) y nombre. */
export function sortItems(items: readonly PantryItem[]): PantryItem[] {
  const order = (f: PantryFrequency) => PANTRY_FREQUENCIES.indexOf(f)
  return [...items].sort((a, b) => order(a.frequency) - order(b.frequency) || byName(a, b))
}

// ---------------------------------------------------------------------------
// Textos

const quantityFormatter = new Intl.NumberFormat('es-ES', { maximumFractionDigits: QUANTITY_DECIMALS })

/** 4 → "4", 1.5 → "1,5", 0.25 → "0,25" (sin ceros decimales de más). */
export function formatQuantity(value: number): string {
  return quantityFormatter.format(value)
}

const UNIT_NAMES: Record<PantryUnit, [singular: string, plural: string]> = {
  ud: ['ud', 'ud'],
  g: ['g', 'g'],
  kg: ['kg', 'kg'],
  ml: ['ml', 'ml'],
  l: ['l', 'l'],
  paquete: ['paquete', 'paquetes'],
  lata: ['lata', 'latas'],
  botella: ['botella', 'botellas'],
  bolsa: ['bolsa', 'bolsas'],
  docena: ['docena', 'docenas'],
}

/** Nombre de la unidad para el selector: «ud», «paquete»… */
export function unitName(unit: PantryUnit): string {
  return UNIT_NAMES[unit][0]
}

/** "4 l", "1 docena", "2 docenas". */
export function describeQuantity(value: number, unit: PantryUnit): string {
  const [singular, plural] = UNIT_NAMES[unit]
  return `${formatQuantity(value)} ${value === 1 ? singular : plural}`
}

/** Lo que significa el precio de un producto: «€/kg» también para los gramos. */
export function priceUnitLabel(unit: PantryUnit): string {
  if (unit === 'g' || unit === 'kg') return '€/kg'
  if (unit === 'ml' || unit === 'l') return '€/l'
  return `€/${UNIT_NAMES[unit][0]}`
}

/** Los avisos de WhatsApp y los .txt se leen mejor con espacios normales que con los de no separación de Intl. */
const plainSpaces = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ')

export const formatEurosPlain = (cents: number) => plainSpaces(formatEuros(cents))

function formatCalendarDate(value: ISODate): string {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

export interface ShoppingListFilter {
  /** Fecha de la lista (AAAA-MM-DD). */
  date: ISODate
  owner: OwnerFilter
  frequencies: readonly PantryFrequency[]
}

/** Productos que entran en la lista: los que hay que comprar y cumplen los filtros. */
export function shoppingListItems(items: readonly PantryItem[], filter: ShoppingListFilter, rhythms?: Rhythms): PantryItem[] {
  return sortItems(
    items.filter((item) => needsBuying(item, rhythms) && matchesOwner(item, filter.owner) && filter.frequencies.includes(item.frequency)),
  )
}

/**
 * Lista de la compra en texto plano, lista para WhatsApp (los *asteriscos* son
 * negrita). Primero lo compartido y después cada persona; dentro, lo semanal,
 * lo mensual y lo ocasional, cada bloque por nombre. Muestra lo que falta.
 */
export function listaCompraTexto(
  items: readonly PantryItem[],
  personas: readonly PantryPerson[],
  filtro: ShoppingListFilter,
  rhythms?: Rhythms,
): string {
  const included = shoppingListItems(items, filtro, rhythms)
  const lines = [`🛒 Lista de la compra · ${formatCalendarDate(filtro.date)}`]

  const groups: { title: string; items: PantryItem[] }[] = [
    { title: 'Compartido', items: included.filter((item) => item.ownerId === null) },
    ...sortPeople(personas).map((person) => ({ title: person.name, items: included.filter((item) => item.ownerId === person.id) })),
  ]
  const shown = groups.filter((group) => group.items.length > 0)
  if (shown.length === 0) return `${lines[0]}\n\nNo falta nada.`

  for (const group of shown) {
    lines.push('', `*${group.title}*`)
    for (const item of group.items) {
      const quantity = listQuantity(item, rhythms)
      lines.push(quantity === null || quantity <= 0 ? `• ${item.name}` : `• ${item.name} — ${describeQuantity(quantity, item.unit)}`)
    }
  }

  const listed = shown.flatMap((group) => group.items)
  const total = sumKnown(listed.map((item) => listCostCents(item, rhythms)))
  if (total.withoutPrice < listed.length) {
    const label = total.withoutPrice > 0 ? 'Total estimado parcial' : 'Total estimado'
    lines.push('', `${label}: ${formatEurosPlain(total.cents)}`)
  }
  return lines.join('\n')
}

/** Enlace que abre WhatsApp con el texto ya escrito (sin enviarlo). */
export function whatsAppUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}
