import { describe, expect, it } from 'vitest'
import cases from '../../fixtures/tickets/ticket-cases.json'
import { linesFromText, parseTicket } from './ticketParse.ts'
import { roundRatio } from './ticketArithmetic.ts'

describe('fixtures identificadas por procedencia', () => {
  it.each(cases)('$id ($provenance)', fixture => {
    const t = parseTicket([linesFromText(fixture.text)])
    const e = fixture.expected
    expect(t).toMatchObject({ date: e.date, time: e.time, totalCents: e.totalCents, check: { status: e.status } })
    expect(t.lines).toHaveLength(e.lines.length)
    expect(t.lines).toMatchObject(e.lines)
    expect(t.adjustments.map(a => a.amountCents)).toEqual(e.adjustments)
  })
  it.each(['3,95x 2', '3,95 x 2', '3,95 × 2'])('multiplicación %s', value => {
    const t = parseTicket([linesFromText(`LIDL\nEUR\nBURGER ${value} 7,90 B\nTOTAL 7,90`)])
    expect(t.lines[0]).toMatchObject({ quantity: 2, unitPriceCents: 395, amountCents: 790 })
  })
  it('redondea fracciones monetarias y devoluciones sin coma flotante', () => {
    expect(roundRatio(544 * 675, 1000)).toBe(367)
    expect(roundRatio(547 * 758, 1000)).toBe(415)
    expect(roundRatio(5, 2)).toBe(3)
    expect(roundRatio(-5, 2)).toBe(-3)
  })
  // «segmenta una captura larga…» prueba código de la web (imageLayout): está en src/ui/ticketImages.test.ts.
})
