import type { ISODate } from './types.ts'

/**
 * Utilidades de fechas de calendario ("AAAA-MM-DD").
 *
 * Se trabaja con año, mes y día como números en lugar de con objetos Date,
 * porque new Date('2026-03-01') se interpreta en UTC y puede mostrar el día
 * anterior según la zona horaria. Comparar dos fechas ISO es comparar cadenas.
 */

export interface DateParts {
  year: number
  /** 1 = enero … 12 = diciembre */
  month: number
  day: number
}

export const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

const pad2 = (value: number) => String(value).padStart(2, '0')

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export function toISODate(year: number, month: number, day: number): ISODate {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`
}

/** Devuelve las partes de una fecha ISO o null si no es una fecha real. */
export function parseISODate(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1900 || year > 2999) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

export function isValidISODate(value: unknown): value is ISODate {
  return typeof value === 'string' && parseISODate(value) !== null
}

function partsOf(value: ISODate): DateParts {
  const parts = parseISODate(value)
  if (!parts) throw new Error(`Fecha no válida: ${value}`)
  return parts
}

/** Fecha de hoy según el reloj local del dispositivo. */
export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/** Suma (o resta) meses a un año/mes. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/**
 * Suma meses conservando el día del mes. Si ese día no existe en el mes de
 * destino (por ejemplo, el 31 en abril), usa el último día del mes.
 * 31/01 + 1 mes = 28/02 (o 29/02), y 31/01 + 2 meses = 31/03.
 */
export function addMonthsClamped(value: ISODate, months: number): ISODate {
  const { year, month, day } = partsOf(value)
  const target = shiftMonth(year, month, months)
  return toISODate(target.year, target.month, Math.min(day, daysInMonth(target.year, target.month)))
}

/** Primer y último día del mes. */
export function monthBounds(year: number, month: number): { start: ISODate; end: ISODate } {
  return { start: toISODate(year, month, 1), end: toISODate(year, month, daysInMonth(year, month)) }
}

export function isInMonth(value: ISODate, year: number, month: number): boolean {
  return value.startsWith(`${String(year).padStart(4, '0')}-${pad2(month)}-`)
}

/** Último día del mes siguiente al de la fecha dada (horizonte de generación). */
export function endOfNextMonth(value: ISODate): ISODate {
  const { year, month } = partsOf(value)
  const next = shiftMonth(year, month, 1)
  return monthBounds(next.year, next.month).end
}

/** Días desde `from` hasta `to` (negativo si `to` es anterior). */
export function daysBetween(from: ISODate, to: ISODate): number {
  const a = partsOf(from)
  const b = partsOf(to)
  const ms = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)
  return Math.round(ms / 86_400_000)
}

export function addDays(value: ISODate, days: number): ISODate {
  const { year, month, day } = partsOf(value)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return toISODate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

/** "2026-10-05" -> "05/10/2026" */
export function formatDate(value: ISODate | null): string {
  if (!value) return ''
  const { year, month, day } = partsOf(value)
  return `${pad2(day)}/${pad2(month)}/${year}`
}

/** "octubre de 2026" */
export function formatMonthYear(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} de ${year}`
}

/** 10 -> "oct" (para las columnas de las tablas anuales). */
export function shortMonthName(month: number): string {
  return MONTH_NAMES[month - 1].slice(0, 3)
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Texto relativo para un vencimiento: "Vence hoy", "Venció hace 3 días"… */
export function describeDue(dueDate: ISODate, today: ISODate): string {
  const days = daysBetween(today, dueDate)
  if (days === 0) return 'Vence hoy'
  if (days === 1) return 'Vence mañana'
  if (days > 1) return `Vence en ${days} días`
  if (days === -1) return 'Venció ayer'
  return `Venció hace ${-days} días`
}

/** Fecha y hora local legibles a partir de un instante ISO (para copias de seguridad). */
export function formatDateTime(isoInstant: string): string {
  const date = new Date(isoInstant)
  if (Number.isNaN(date.getTime())) return ''
  return `${formatDate(todayISO(date))}, ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}
