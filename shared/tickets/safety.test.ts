import { describe, expect, it } from 'vitest'
import { suggestForTicket } from './match.ts'
import { linesFromText, mergePages, parseTicket } from './parse.ts'
import { nameKey } from './text.ts'

const parse = (...lines: string[]) => parseTicket([linesFromText(['LIDL', 'EUR', ...lines].join('\n'))])

describe('regresiones de seguridad de tickets', () => {
  it('no cambia una cifra únicamente para cuadrar el total', () => {
    const t = parse('RULO DE CABRA 2,23 A', 'DATIL SIN HUESO 1,25 A', 'TOTAL 3,54')
    expect(t.lines.map(l => l.amountCents)).toEqual([223, 125])
    expect(t.check.status).toBe('no_cuadra')
  })
  it('no inventa el único importe ilegible', () => {
    const t = parse('ARROZ 1,09 A', 'COOKIES ???', 'TOTAL 2,38')
    expect(t.lines[1].amountCents).toBeNull()
    expect(t.check.unreadable).toBe(1)
  })
  it('cierra productos al llegar al pago aunque falte TOTAL', () => {
    const t = parse('PAN 1,00 A', 'Lidl Pay 1,00', 'FECHA: 28/10/26', 'HORA: 19:24:38',
      'IVA BASE CUOTA', 'A 4% 0,96 0,04', 'Ofertas Lidl Plus', 'CHOCOLATE 2,99 B', 'Puntos Lidl 250')
    expect(t.lines.map(l => l.rawName)).toEqual(['PAN'])
    expect(t).toMatchObject({ totalCents: 100, date: '2026-10-28', time: '19:24' })
  })
  it('conserva un cupón general separado del producto anterior', () => {
    const t = parse('PAN 1,00 A', 'LECHE 1,00 A', 'CUPON COMPRA -0,50', 'TOTAL 1,50')
    expect(t.lines.map(l => l.discountCents)).toEqual([0, 0])
    expect(t).toMatchObject({ adjustments: [{ amountCents: -50, kind: 'coupon' }] })
    expect(t.check.status).toBe('cuadra')
  })
  it.each([0, -89])('admite total cero o devolución: %i céntimos', cents => {
    const amount = (cents / 100).toFixed(2).replace('.', ',')
    expect(parse(`LECHE ${amount} A`, `TOTAL ${amount}`).totalCents).toBe(cents)
  })
  it('no elimina dos artículos repetidos en un solape ambiguo', () => {
    const pages = [['EUR', 'LECHE 1,00 A', 'LECHE 1,00 A'], ['LECHE 1,00 A', 'LECHE 1,00 A', 'TOTAL 4,00']]
    expect(mergePages(pages.map(p => linesFromText(p.join('\n'))))).toHaveLength(6)
  })
  it('no fusiona variantes nuevas por parecido', () => {
    const names = ['YOGUR NATURAL 0%', 'YOGUR NATURAL 2%']
    const result = suggestForTicket(names.map(rawName => ({ rawName, key: nameKey(rawName) })), [], [])
    expect(result.get(nameKey(names[0]))).not.toEqual(result.get(nameKey(names[1])))
  })
  it('conserva las dudas aunque los errores se compensen en el total', () => {
    const t = parseTicket([[...linesFromText('LIDL\nEUR'),
      { text: 'PAN 1,00 A', reread: '1,10 A' }, { text: 'SAL 1,00 A', reread: '0,90 A' },
      ...linesFromText('TOTAL 2,00')]])
    expect(t.lines.every(l => l.flags.includes('dudoso'))).toBe(true)
  })
})
