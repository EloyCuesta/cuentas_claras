import { centsToInput, MINUS, parseAmount } from '../../domain/money.ts'
import type { TicketDraft, TicketSuggestion } from '../../domain/ticketMatch.ts'
import type { ParsedTicketLine, TicketLineFlag } from '../../domain/ticketParse.ts'
import type { PantryFrequency, TicketDecision, TicketSaveInput } from '../../domain/types.ts'

/**
 * Estado de la revisión de un ticket (ver TicketReview.tsx): lo que el usuario
 * decide con cada producto y los importes corregidos, y cómo se convierte en lo
 * que se guarda.
 */

/** Decisión en la revisión (ownerId '' = Compartido). */
export type Choice =
  | { kind: 'item'; itemId: string }
  | { kind: 'new'; name: string; ownerId: string; frequency: PantryFrequency }
  | { kind: 'ignore' }

export interface ReviewLine extends ParsedTicketLine {
  occasional: boolean
  /** Texto del campo de importe mientras se edita. */
  amountText: string
}

export type SectionId = 'revisar' | 'nuevos' | 'conocidos' | 'ignorados'

export interface ReviewState {
  storeName: string
  date: string
  totalText: string
  lines: ReviewLine[]
  choices: Record<string, Choice>
  /** En qué apartado va cada producto. Se decide al abrir, para que no salte de sitio mientras se corrige. */
  sections: Record<string, SectionId>
}

export const WARNING_FLAGS: readonly TicketLineFlag[] = ['ilegible', 'deducido', 'dudoso']

function choiceFromSuggestion(suggestion: TicketSuggestion | undefined, rawName: string, defaultOwnerId: string): Choice {
  if (!suggestion) return { kind: 'new', name: rawName, ownerId: defaultOwnerId, frequency: 'semanal' }
  if (suggestion.kind === 'item') return { kind: 'item', itemId: suggestion.itemId }
  if (suggestion.kind === 'ignore') return { kind: 'ignore' }
  return { kind: 'new', name: suggestion.name, ownerId: defaultOwnerId, frequency: suggestion.frequency }
}

export function initialReview(draft: TicketDraft, today: string, defaultOwnerId: string): ReviewState {
  const choices: Record<string, Choice> = {}
  const sections: Record<string, SectionId> = {}
  for (const line of draft.ticket.lines) {
    const suggestion = draft.suggestions[line.key]
    choices[line.key] ??= choiceFromSuggestion(suggestion, line.rawName, defaultOwnerId)
    const look =
      line.amountCents === null ||
      line.flags.some((flag) => WARNING_FLAGS.includes(flag)) ||
      (suggestion?.kind === 'item' && suggestion.how !== 'recordado')
    const choice = choices[line.key]
    if (look) sections[line.key] = 'revisar'
    else sections[line.key] ??= choice.kind === 'new' ? 'nuevos' : choice.kind === 'item' ? 'conocidos' : 'ignorados'
  }
  return {
    sections,
    storeName: draft.ticket.storeName,
    date: draft.ticket.date ?? today,
    totalText: draft.ticket.totalCents === null ? '' : centsToInput(draft.ticket.totalCents),
    lines: draft.ticket.lines.map((line) => ({
      ...line,
      occasional: false,
      amountText: line.amountCents === null ? '' : centsToInput(line.amountCents),
    })),
    choices,
  }
}

/** Importe escrito en la revisión: vacío = sin importe; admite negativos (devoluciones). */
export function readAmount(text: string): { ok: true; cents: number | null } | { ok: false } {
  const raw = text.replace(/\s/g, '')
  if (raw === '') return { ok: true, cents: null }
  const negative = raw.startsWith('-') || raw.startsWith(MINUS)
  const digits = negative ? raw.slice(1) : raw
  if (/^0+([.,]0{1,2})?$/.test(digits)) return { ok: true, cents: 0 }
  const parsed = parseAmount(digits)
  return parsed.ok ? { ok: true, cents: negative ? -parsed.cents : parsed.cents } : { ok: false }
}

export const lineAmount = (line: ReviewLine) => {
  const read = readAmount(line.amountText)
  return read.ok ? read.cents : null
}

/** Lo que hay que enviar al guardar, o el primer problema que lo impide. */
export function reviewToInput(draft: TicketDraft, review: ReviewState): { ok: true; input: TicketSaveInput } | { ok: false; error: string } {
  if (review.storeName.trim() === '') return { ok: false, error: 'Escribe el nombre de la tienda.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(review.date)) return { ok: false, error: 'Elige la fecha del ticket.' }
  const total = readAmount(review.totalText)
  if (!total.ok || (total.cents !== null && total.cents < 0)) return { ok: false, error: 'El total del ticket no es un importe válido.' }
  const badLine = review.lines.find((line) => !readAmount(line.amountText).ok)
  if (badLine) return { ok: false, error: `El importe de «${badLine.rawName}» no es válido.` }
  const decisions: Record<string, TicketDecision> = {}
  for (const [key, choice] of Object.entries(review.choices)) {
    if (choice.kind === 'new') {
      const name = choice.name.trim()
      if (name === '') return { ok: false, error: 'Falta el nombre de algún producto nuevo.' }
      decisions[key] = { kind: 'new', name, ownerId: choice.ownerId === '' ? null : choice.ownerId, frequency: choice.frequency }
    } else decisions[key] = choice
  }
  return {
    ok: true,
    input: {
      store: draft.ticket.store,
      storeName: review.storeName.trim(),
      address: draft.ticket.address,
      date: review.date,
      time: draft.ticket.time,
      totalCents: total.cents,
      lines: review.lines.map((line) => ({
        rawName: line.rawName,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        amountCents: lineAmount(line),
        discountCents: line.discountCents,
        weightKg: line.weightKg,
        pricePerKgCents: line.pricePerKgCents,
        taxCode: line.taxCode,
        occasional: line.occasional,
      })),
      decisions,
    },
  }
}
