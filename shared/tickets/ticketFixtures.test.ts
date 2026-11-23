import { describe, expect, it } from 'vitest'
import cases from '../../fixtures/tickets/ticket-cases.json'
import lidlPlusCapture from '../../fixtures/tickets/ocr-real/lidl-plus-captura-422px.json'
import lidlPlusTruth from '../../fixtures/tickets/ticket-lidl-plus-cupones.json'
import { linesFromText, parseTicket } from './ticketParse.ts'
import { roundRatio } from './ticketArithmetic.ts'
import type { OcrLine } from './types.ts'

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

/**
 * Lo que leyó de verdad el OCR de una captura de Lidl Plus que aportó el usuario (422 px,
 * dos franjas preparadas como en el navegador). La captura no está en el repositorio, y
 * los datos de pago y de la tienda están cambiados (ver la nota de la fixture).
 */
describe('OCR real de una captura de Lidl Plus con cupones y pago con tarjeta', () => {
  const ticket = parseTicket(lidlPlusCapture.pages as OcrLine[][])

  it('lee todas las líneas en orden, sin ningún importe erróneo aceptado en silencio', () => {
    expect(ticket).toMatchObject({ store: 'lidl', date: lidlPlusTruth.date, time: lidlPlusTruth.time,
      totalCents: lidlPlusTruth.totalCents, paymentMethod: 'Tarjeta' })
    expect(ticket.lines.map(l => l.rawName)).toEqual(lidlPlusTruth.lines.map(l => l.rawName))
    lidlPlusTruth.lines.forEach((real, i) => {
      const line = ticket.lines[i]
      expect([line.quantity, line.unitPriceCents, line.taxCode], real.rawName).toEqual([real.quantity, real.unitPriceCents, real.taxCode])
      if (line.amountCents !== real.amountCents) expect(line.flags.length, real.rawName).toBeGreaterThan(0)
    })
  })

  it('«0,15 C» leído «0 18:»: el importe sale solo de la relectura y queda por confirmar', () => {
    const bag = ticket.lines.find(l => l.rawName === 'BOLSA DE COMPRA')!
    expect(bag).toMatchObject({ amountCents: 15, taxCode: 'C', flags: ['dudoso'] })
    expect(bag.evidence).toMatchObject({ text: expect.stringMatching(/0 18:$/), reread: '0,15 C', selectedBy: 'reread' })
    expect(bag.evidence!.issues).toContain('El importe solo se lee en la relectura de cifras')
    // Las demás líneas, leídas igual en las dos pasadas o comprobadas con la multiplicación, no se marcan
    // (el aceite y los nachos, solo por su PROMO sangrada: ver el test siguiente).
    expect(ticket.lines.filter(l => l.flags.length).map(l => l.rawName)).toEqual(['ACEITE DE GIRASOL', 'NACHOS TEX MEX', 'BOLSA DE COMPRA'])
    expect(ticket.check).toMatchObject({ status: 'pendiente', differenceCents: 0, unreadable: 0, pending: 3 })
  })

  it('los cupones «PROMO LIDL PLUS» sangrados se proponen como descuento de su producto, por confirmar, y lo de después del total no son compras', () => {
    // Van sangrados justo debajo de su producto: su descuento, sugerido; nunca un descuento aceptado sin confirmar.
    expect(ticket.adjustments).toEqual([])
    const promos = ticket.lines.filter(l => l.discountCents !== 0)
    expect(promos.map(l => [l.rawName, -l.discountCents])).toEqual([['ACEITE DE GIRASOL', -184], ['NACHOS TEX MEX', -89]])
    expect(promos.map(l => -l.discountCents)).toEqual(lidlPlusTruth.adjustments)
    for (const line of promos) {
      expect(line.flags).toEqual(['dudoso'])
      expect(line.evidence!.issues).toContain('«PROMO LIDL PLUS» va sangrada debajo de este producto: se le propone como descuento, confírmalo')
    }
    // «ENTREGA 142,37» (mal leído), el desglose, los cupones «GRATIS» y los puntos de la app no son líneas ni cambian el total.
    expect(ticket.lines.some(l => /GRATIS|girasol 1|Puntos|ENTREGA|Suma/i.test(l.rawName))).toBe(false)
    expect(ticket.taxGroups?.map(g => [g.code, g.grossCents])).toEqual([['B', 1222], ['C', 15]])
    expect(ticket.address).toBe('Avda. del Ejemplo, s/n, 39300 Torrelavega')
  })
})
