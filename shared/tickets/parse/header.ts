import { isValidISODate, toISODate } from '../../core/dates.ts'
import type { ISODate } from '../../core/types.ts'
import type { OcrLine } from '../types.ts'
import { letterCount } from './clean.ts'
import type { TicketStore } from './types.ts'

/** Cabecera: tienda, dirección, fecha y hora. */

export function detectStore(lines: readonly OcrLine[]): TicketStore {
  return lines.slice(0, 15).some((line) => /\bLIDL\b/i.test(line.text)) ? 'lidl' : 'otra'
}

export function storeNameOf(store: TicketStore, lines: readonly OcrLine[]): string {
  if (store === 'lidl') return 'Lidl'
  const first = lines.find((line) => letterCount(line.text) >= 3)
  if (!first) return 'Tienda'
  const name = first.text
    .replace(/\b(S\.?\s?A\.?\s?U?\.?|S\.?\s?L\.?\s?U?\.?)\s*$/i, '')
    .replace(/[,.\s]+$/, '')
    .trim()
  const pretty = name.charAt(0).toLocaleUpperCase('es') + name.slice(1).toLocaleLowerCase('es')
  return pretty.slice(0, 60) || 'Tienda'
}

export function addressOf(store: TicketStore, lines: readonly OcrLine[]): string {
  if (store !== 'lidl') return ''
  const header = lines.findIndex((line) => /LIDL\s+SUPERMERCADOS/i.test(line.text))
  if (header === -1) return ''
  const parts: string[] = []
  for (const line of lines.slice(header + 1, header + 5)) {
    if (/\bNIF\b|www\.|^\s*EUR\s*$/i.test(line.text)) break
    const text = line.text.replace(/(\d{5})(?=\p{L})/u, '$1 ').replace(/\s+/g, ' ').trim()
    if (text) parts.push(text)
  }
  return parts.slice(0, 2).join(', ').slice(0, 120)
}

function readDate(day: string, month: string, year: string): ISODate | null {
  const fullYear = year.length === 2 ? 2000 + Number(year) : Number(year)
  const iso = toISODate(fullYear, Number(month), Number(day))
  return isValidISODate(iso) ? iso : null
}

export function dateAndTime(lines: readonly OcrLine[]): { date: ISODate | null; time: string | null } {
  let date: ISODate | null = null
  let time: string | null = null
  for (const { text } of lines) {
    const labeledDate = /FECHA\W*(\d{2})[/.-](\d{2})[/.-](\d{2,4})/i.exec(text)
    if (labeledDate && !date) date = readDate(labeledDate[1], labeledDate[2], labeledDate[3])
    const labeledTime = /HORA\W*(\d{2})[:.](\d{2})/i.exec(text)
    if (labeledTime && !time && Number(labeledTime[1]) < 24 && Number(labeledTime[2]) < 60) time = `${labeledTime[1]}:${labeledTime[2]}`
  }
  if (!date || !time) {
    // Pie del ticket («4017 564330/01 28.10.26 19:22») u otras tiendas («28/10/2026 19:24»).
    for (const { text } of lines) {
      const match = /\b(\d{2})[/.-](\d{2})[/.-](\d{2}|\d{4})\b(?:\s+(\d{2}):(\d{2}))?/.exec(text)
      if (!match) continue
      const found = readDate(match[1], match[2], match[3])
      if (!found) continue
      date ??= found
      if (!time && match[4] && Number(match[4]) < 24 && Number(match[5]) < 60) time = `${match[4]}:${match[5]}`
      if (date && time) break
    }
  }
  return { date, time }
}
