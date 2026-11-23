import { describe, expect, it } from 'vitest'
import type { TicketDraft } from '#shared/tickets/ticketMatch.ts'
import { linesFromText, parseTicket } from '#shared/tickets/ticketParse.ts'
import { chooseAmountChange, initialReview, lineState, lineToInput, needsLineCheck, reviewCheck, reviewToInput, type ReviewLine, type ReviewState } from './ticketReviewState.ts'

const draftOf = (text: string): TicketDraft => {
  const ticket = parseTicket([linesFromText(text)])
  return { ticket, suggestions: {}, duplicate: null, importId: 'import-0123456789abcdef', sourceFingerprint: 'source-0123456789abcdef' }
}
const POTATOES = 'LIDL\nEUR\nPATATA NUEVA 5 KG   4,95X   2   92,90 A\nHUEVOS MEDIANOS M   2,84X   2   5,68 A\nTOTAL 15,58\nFECHA: 28/10/26'
const update = (review: ReviewState, position: number, change: Partial<ReviewLine>): ReviewState =>
  ({ ...review, lines: review.lines.map(l => l.position === position ? { ...l, ...change } : l) })

describe('revisión de un ticket con un importe mal leído', () => {
  const draft = draftOf(POTATOES)
  const review = initialReview(draft, '2026-10-29', '')
  const potato = review.lines[0]

  it('la línea de las patatas está «sugerida» y a la vista; la de los huevos, comprobada', () => {
    expect(lineState(potato)).toBe('sugerido')
    expect(needsLineCheck(potato)).toBe(true)
    expect(lineState(review.lines[1])).toBe('comprobado')
    expect(needsLineCheck(review.lines[1])).toBe(false)
  })
  it('sin confirmar se guardaría pendiente, con 9,90 y la lectura 92,90 en la evidencia', () => {
    const saved = lineToInput(potato).line
    expect(saved).toMatchObject({ amountCents: 990, reviewStatus: 'pending', evidence: { recognizedCents: 9290 } })
    expect(reviewCheck(review)).toMatchObject({ status: 'pendiente', differenceCents: 0 })
  })
  it('«Usar 9,90 €» confirma la línea y la deja lista para la despensa', () => {
    const next = update(review, 0, chooseAmountChange(potato, { cents: 990, origin: 'calculation' }))
    expect(lineState(next.lines[0])).toBe('confirmado')
    expect(lineToInput(next.lines[0]).line).toMatchObject({ amountCents: 990, reviewStatus: 'verified', confirmed: true,
      evidence: { selectedBy: 'calculation', recognizedCents: 9290 } })
    expect(reviewCheck(next).status).toBe('cuadra')
    const input = reviewToInput(draft, next)
    expect(input.ok && input.input.lines[0].reviewStatus).toBe('verified')
  })
  it('«Usar 92,90 € (leído)» deja la incoherencia pendiente: no se puede aplicar así', () => {
    const next = update(review, 0, chooseAmountChange(potato, { cents: 9290, origin: 'read' }))
    expect(lineState(next.lines[0])).toBe('pendiente')
    expect(lineToInput(next.lines[0]).line.reviewStatus).toBe('pending')
    expect(reviewCheck(next).status).toBe('no_cuadra')
  })
  it('«Dejar pendiente» se respeta aunque el importe sea coherente, y se puede deshacer', () => {
    const held = update(review, 1, { heldPending: true })
    expect(lineState(held.lines[1])).toBe('pendiente')
    expect(lineToInput(held.lines[1]).line.reviewStatus).toBe('pending')
    expect(lineState(update(held, 1, { heldPending: false }).lines[1])).toBe('comprobado')
  })
  it('editar a mano la cifra deja la línea sin confirmar hasta que se confirme', () => {
    const edited = update(review, 0, { amountText: '9,90', confirmed: false })
    expect(lineState(edited.lines[0])).toBe('sugerido')
    expect(lineState(update(edited, 0, { confirmed: true }).lines[0])).toBe('confirmado')
  })
})

describe('el desglose de IVA en la revisión', () => {
  it('avisa si un grupo no coincide aunque el total sí', () => {
    const draft = draftOf('LIDL\nEUR\nPAN 1,00 A\nLECHE 1,00 B\nTOTAL 2,00\nLidl Pay 2,00\nA 4% 1,15 0,05 1,20\nB 10% 0,73 0,07 0,80\nFECHA: 28/10/26')
    const review = initialReview(draft, '2026-10-29', '')
    expect(reviewCheck(review)).toMatchObject({ status: 'pendiente', taxMismatches: [{ code: 'A', differenceCents: 20 }, { code: 'B', differenceCents: -20 }] })
    // Corregidas las dos cifras a mano, cuadra todo.
    const fixed = update(update(review, 0, { amountText: '1,20', confirmed: true }), 1, { amountText: '0,80', confirmed: true })
    expect(reviewCheck(fixed)).toMatchObject({ status: 'cuadra', taxMismatches: [] })
  })
})

describe('lo que pide la revisión de cada línea y de la cabecera', () => {
  it('una línea emparejada con un producto solo por parecido tiene su tarjeta hasta confirmar el producto', () => {
    const ticket = parseTicket([linesFromText('LIDL\nEUR\nLECHE SEMI 0,95 A\nTOTAL 0,95\nFECHA: 28/10/26')])
    const draft: TicketDraft = { ticket, suggestions: { [ticket.lines[0].key]: { kind: 'item', itemId: 'leche', how: 'parecido' } },
      duplicate: null, importId: 'import-0123456789abcdef', sourceFingerprint: 'source-0123456789abcdef' }
    const review = initialReview(draft, '2026-10-29', '')
    const [line] = review.lines
    expect(lineState(line)).toBe('pendiente')
    expect(needsLineCheck(line)).toBe(true)
    const confirmed = update(review, 0, { associationConfirmed: true })
    expect(lineState(confirmed.lines[0])).toBe('comprobado')
    expect(needsLineCheck(confirmed.lines[0])).toBe(false)
  })
  it('un error de la cabecera dice su campo, para llevar el foco a él', () => {
    const draft = draftOf(POTATOES)
    const review = initialReview(draft, '2026-10-29', '')
    expect(reviewToInput(draft, { ...review, storeName: '  ' })).toEqual({ ok: false, error: 'Escribe el nombre de la tienda.', field: 'store' })
    expect(reviewToInput(draft, { ...review, date: '0002-10-28' })).toEqual({ ok: false, error: 'Elige una fecha válida para el ticket.', field: 'date' })
    expect(reviewToInput(draft, { ...review, time: '25:00' })).toEqual({ ok: false, error: 'Escribe una hora válida.', field: 'time' })
    expect(reviewToInput(draft, { ...review, totalText: 'doce' })).toEqual({ ok: false, error: 'El total del ticket no es un importe válido.', field: 'total' })
  })
})
