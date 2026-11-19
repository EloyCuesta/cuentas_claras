import { describe, expect, it } from 'vitest'
import { linesFromText, parseTicket } from '#shared/tickets/ticketParse.ts'
import { align, compareTicket } from './comparar.ts'
import { table } from './informe.ts'
import type { Verdad, VerdadLinea } from './verdad.ts'

const line = (rawName: string, amountCents: number, extra: Partial<VerdadLinea> = {}): VerdadLinea => ({
  rawName, quantity: 1, unitPriceCents: null, amountCents, discountCents: 0, weightKg: null, pricePerKgCents: null, taxCode: 'B', ...extra,
})

const truth = (lines: VerdadLinea[], extra: Partial<Verdad> = {}): Verdad => ({
  date: '2026-11-03', time: '18:47', totalCents: lines.reduce((s, l) => s + l.amountCents - l.discountCents, 0), lines, adjustments: [], ...extra,
})

const read = (text: string) => parseTicket([linesFromText(text)])

describe('comparar lo leído con la verdad', () => {
  it('empareja en orden los productos repetidos y deja sin pareja lo que falta', () => {
    const ticket = read('LIDL\nEUR\nPAN 1,00 B\nPAN 1,00 B\nLECHE 0,90 B\nTOTAL 2,90\nFECHA: 03/11/26\nHORA: 18:47:12')
    expect(align([line('PAN', 100), line('PAN', 100), line('HUEVOS', 250), line('LECHE', 90)], ticket.lines)).toEqual([[0, 0], [1, 1], [3, 2]])
  })

  it('separa lo limpio, lo marcado y, sobre todo, lo mal leído sin marcar', () => {
    // «2,75X» se lee hoy como un importe de 2,75 y una unidad, sin aviso (lo que el banco tiene que encontrar).
    const ticket = read('LIDL\nEUR\nPAN 1,00 B\nLASAÑA 5 QUESOS      2,75X\nYOGUR 0,55x 4 2,20 A\nTOTAL 8,70\nFECHA: 03/11/26\nHORA: 18:47:12')
    const result = compareTicket(truth([
      line('PAN', 100),
      line('LASAÑA 5 QUESOS', 550, { quantity: 2, unitPriceCents: 275 }),
      line('YOGUR', 220, { quantity: 4, unitPriceCents: 55, taxCode: 'A' }),
    ]), ticket)
    expect(result).toMatchObject({ products: 3, clean: 2, silentWrong: 1, missing: 0, date: true, time: true, total: true })
    expect(result.lines[1]).toMatchObject({ class: 'mal-sin-marcar', differences: ['importe 2,75 ≠ 5,50', 'cantidad 1 ≠ 2', 'precio — ≠ 2,75'] })
  })

  it('una línea que no es del ticket sobra, y una copia de un producto sobra como repetida', () => {
    const ticket = read('LIDL\nEUR\nPAN 1,00 B\nPAN 1,00 B\nTicket de compra 0,00 B\nTOTAL 1,00\nFECHA: 03/11/26')
    const result = compareTicket(truth([line('PAN', 100)]), ticket)
    expect(result).toMatchObject({ extraRepeated: 1, extraOther: 1 })
  })

  it('la PROMO vale como ajuste o como descuento de la línea de encima', () => {
    const promo = truth([line('CAFÉ', 349)], { adjustments: [{ label: 'PROMO LIDL PLUS', amountCents: -35, line: 0 }] })
    const asAdjustment = read('LIDL\nEUR\nCAFÉ 3,49 B\nPROMO LIDL PLUS -0,35\nTOTAL 3,14\nFECHA: 03/11/26')
    expect(compareTicket(promo, asAdjustment)).toMatchObject({ adjustments: true, clean: 1 })
    const asDiscount = read('LIDL\nEUR\nCAFÉ 3,49 B\nDesc. -0,35\nTOTAL 3,14\nFECHA: 03/11/26')
    expect(compareTicket(promo, asDiscount)).toMatchObject({ adjustments: true, clean: 1 })
    const lost = read('LIDL\nEUR\nCAFÉ 3,49 B\nTOTAL 3,14\nFECHA: 03/11/26')
    expect(compareTicket(promo, lost).adjustments).toBe(false)
  })

  it('la tabla solo lleva recuentos y ✓/✗, nunca nombres ni importes', () => {
    const ticket = read('LIDL\nEUR\nPAN SECRETO 1,23 B\nTOTAL 1,23\nFECHA: 03/11/26')
    const result = compareTicket(truth([line('PAN SECRETO', 123)]), ticket)
    const text = table([{ name: 'real-1', result, prepareMs: 1200, readMs: 8000 }])
    expect(text).toContain('| real-1 | 1 | 1 (100 %) |')
    expect(text).not.toMatch(/SECRETO|1,23|2026/)
  })
})
