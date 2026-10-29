import { describe, expect, it } from 'vitest'
import ocrFixture from '../../server/fixtures/ticket-lidl-ejemplo.ocr.json'
import truthFixture from '../../server/fixtures/ticket-lidl-ejemplo.json'
import { checkTicket, linesFromText, mergePages, parseTicket } from './ticketParse.ts'
import { guessFrequency, nameKey, prettyName, similarity } from './ticketText.ts'
import type { OcrLine } from './types.ts'

/**
 * El ticket de las pruebas es INVENTADO (server/fixtures/ticket-lidl-ejemplo.png),
 * con el mismo formato que la app Lidl Plus. ticket-lidl-ejemplo.ocr.json es lo
 * que leyó de verdad el OCR de esa imagen (server/ocr.ts), con sus pequeños
 * errores («2,992 A», «1,155A»), y ticket-lidl-ejemplo.json lo que pone el ticket.
 */
const ocrLines = ocrFixture as OcrLine[]
const truth = truthFixture as { date: string; time: string; totalCents: number; lines: Record<string, unknown>[] }

/** Líneas como las del OCR: la lectura normal y, si se da, la de solo cifras. */
const ocr = (...rows: (string | [string, string])[]): OcrLine[] =>
  rows.map((row) => (typeof row === 'string' ? { text: row, reread: null } : { text: row[0], reread: row[1] }))

const HEADER = ['LIDL SUPERMERCADOS S.A.U.', 'Calle del Ejemplo, 12', '39001Santander', 'NIF A00000000', 'EUR']
const FOOTER = ['FECHA: 24/10/26', 'HORA: 18:05:12']

describe('parseTicket con el ticket de ejemplo leído por el OCR', () => {
  const ticket = parseTicket([ocrLines])

  it('lee tienda, dirección, fecha, hora y total', () => {
    expect(ticket).toMatchObject({
      store: 'lidl',
      storeName: 'Lidl',
      address: 'Calle del Ejemplo, 12, 39001 Santander',
      date: truth.date,
      time: truth.time,
      totalCents: truth.totalCents,
    })
  })

  it('lee cada producto: nombre, cantidad, precio, peso, descuentos e IVA', () => {
    expect(ticket.lines.map(({ rawName, quantity, unitPriceCents, amountCents, discountCents, weightKg, pricePerKgCents, taxCode }) => ({
      rawName,
      quantity,
      unitPriceCents,
      amountCents,
      discountCents,
      weightKg,
      pricePerKgCents,
      taxCode,
    }))).toEqual(truth.lines)
  })

  it('cuadra con el total y no marca nada para revisar', () => {
    expect(ticket.check).toEqual({ status: 'cuadra', linesTotalCents: truth.totalCents, differenceCents: 0, unreadable: 0 })
    expect(ticket.lines.flatMap((line) => line.flags)).toEqual([])
    expect(ticket.lines.map((line) => line.key).slice(0, 2)).toEqual(['LECHE SEMIDESNATADA', 'PAN DE MOLDE INTEGRA'])
  })
})

describe('parseTicket con lecturas reales de un ticket de Torrelavega (28/10/26)', () => {
  const ticket = parseTicket([ocr(...HEADER,
    ['CHOCO SHELLS                        1,79 B', '1,725'],
    ['PECHUGA DE POLLO                    3,79B', '3,73 5'],
    ['ACEITUNAS VERDES ANC                3,29 B', '2,23 B'],
    ['BURGER CERDO Y VACU. 3,95x   2     7,920 B', '3, 95Xx 2 7,20 B'],
    ['HUEVOS MEDIANOS M     2,84X   2     5,08 A', '2 ,84X 2 5,08 A'],
    ['PATATA NUEVA 5 KG     4,95X 2     92,90 A', '4, 95Xx 2 92,390 A'],
    'TOTAL 32,35', ...FOOTER)])

  it('prefiere la lectura normal limpia a la relectura que confunde 9 con 3 o B con 5', () => {
    expect(ticket.lines.slice(0, 3).map(l => l.amountCents)).toEqual([179, 379, 329])
  })

  it('reconoce «3, 95Xx» y «2 ,84X» como precio unitario y corrige el importe', () => {
    expect(ticket.lines.slice(3).map(l => [l.quantity, l.unitPriceCents, l.amountCents])).toEqual([[2, 395, 790], [2, 284, 568], [2, 495, 990]])
    expect(ticket.check.status).toBe('cuadra')
  })
})

describe('parseTicket con lecturas difíciles', () => {
  it('usa la segunda lectura cuando la primera se equivoca, y deja el nombre limpio', () => {
    const ticket = parseTicket([
      ocr(
        ...HEADER,
        ['PIZZA FAMI JAM Y QUE                32D', '3,75 6'],
        ['FRUTA Y LECHE MEDIT.                T::19::6', '1,15C'],
        ['MANDARINA NACIONAL                  1,839 A', '1,89 A'],
        ['PAPEL HIGIÉNICO 12R                 3,75 €', '12 3,75 C'],
        'TOTAL                                 10,54',
        ...FOOTER,
      ),
    ])
    expect(ticket.lines.map((l) => [l.rawName, l.amountCents, l.taxCode])).toEqual([
      ['PIZZA FAMI JAM Y QUE', 375, 'B'],
      ['FRUTA Y LECHE MEDIT.', 115, 'C'],
      ['MANDARINA NACIONAL', 189, 'A'],
      ['PAPEL HIGIÉNICO 12R', 375, 'C'],
    ])
    expect(ticket.check.status).toBe('cuadra')
  })

  it('cantidad × precio y peso × precio por kilo corrigen un importe mal leído', () => {
    const ticket = parseTicket([
      ocr(
        ...HEADER,
        ['BURGER CERDO Y VACU. 3,95x   2     7,20 8', '3,95 2 7,20 8'],
        ['LASAÑA 5 QUESOS       2:79X 2     5,50 B', '2,75 2 5,50 B'],
        ['FILETE DE PECHUGA                   4,64 B', '4,64 B'],
        ['0,547 kg x 7,58 EUR/ke', '0,547 kg x 7,58 EUR/kg'],
        'TOTAL                                 17,55',
        ...FOOTER,
      ),
    ])
    expect(ticket.lines.map((l) => [l.rawName, l.quantity, l.unitPriceCents, l.amountCents, l.weightKg])).toEqual([
      ['BURGER CERDO Y VACU.', 2, 395, 790, null],
      ['LASAÑA 5 QUESOS', 2, 275, 550, null],
      ['FILETE DE PECHUGA', 1, null, 415, 0.547],
    ])
    expect(ticket.check.status).toBe('cuadra')
    // El ticket se leyó como 7,20 y 4,64: se avisa de que se han corregido.
    expect(ticket.lines.map((l) => l.flags)).toEqual([['corregido', 'dudoso'], [], ['corregido', 'dudoso']])
    expect(ticket.lines[0].evidence).toMatchObject({ recognizedCents: 720, calculatedCents: 790, selectedBy: 'calculation' })
  })

  it('aplica Desc. al artículo y conserva la promoción como ajuste pendiente', () => {
    const ticket = parseTicket([
      ocr(
        ...HEADER,
        ['PECHUGA DE POLLO                    3,79 B', '3,79 B'],
        ['Desc,                          -0,60', '-0,60'],
        ['COOKIES PEPITAS CHOC                1,29 B', '1,29 B'],
        'PROMO LIDL PLUS               -0, 14',
        'TOTAL                                  4,34',
        ...FOOTER,
      ),
    ])
    expect(ticket.lines.map((l) => [l.rawName, l.amountCents, l.discountCents])).toEqual([
      ['PECHUGA DE POLLO', 379, 60],
      ['COOKIES PEPITAS CHOC', 129, 0],
    ])
    expect(ticket.check).toMatchObject({ status: 'cuadra', linesTotalCents: 434 })
    expect(ticket.adjustments).toEqual([expect.objectContaining({ kind: 'promotion', amountCents: -14, needsReview: true })])
  })

  it('conserva como ilegible un importe sin evidencia aunque se pueda despejar del total', () => {
    const ticket = parseTicket([
      ocr(
        ...HEADER,
        ['ARROZ LARGO                         1,09 A', '1,09 A'],
        ['COOKIES PEPITAS CHOC                1-29:B', '1,2398'],
        'TOTAL                                  2,38',
        ...FOOTER,
      ),
    ])
    expect(ticket.lines[1]).toMatchObject({ rawName: 'COOKIES PEPITAS CHOC', amountCents: null, flags: ['ilegible'] })
    expect(ticket.check.status).toBe('no_cuadra')
  })

  it('no cambia una cifra para explicar la diferencia con el total', () => {
    const ticket = parseTicket([
      ocr(...HEADER, ['RULO DE CABRA                       2,23 A', '2,23 A'], ['DÁTIL SIN HUESO 1,25 A', '1,25 A'], 'TOTAL 3,54', ...FOOTER),
    ])
    expect(ticket.lines.map((l) => [l.amountCents, l.flags])).toEqual([
      [223, []],
      [125, []],
    ])
  })

  it('si no cuadra, lo dice y marca lo dudoso sin inventarse nada', () => {
    const ticket = parseTicket([
      ocr(
        ...HEADER,
        ['PIZZA JAMON Y QUESO                 2,33 B', '2,3 8'],
        ['RULO DE CABRA                       2,23 A', '2,23 A'],
        'NOCILLA                             4,45 B',
        'TOTAL                                  9,12',
        ...FOOTER,
      ),
    ])
    expect(ticket.check).toEqual({ status: 'no_cuadra', linesTotalCents: 901, differenceCents: 11, unreadable: 0 })
    // Un descuadre global no demuestra cuál de los importes es incorrecto.
    expect(ticket.issues).toContain('Los importes no cuadran con el total')
    expect(ticket.lines.map((l) => l.amountCents)).toEqual([233, 223, 445])
    // Dos ilegibles: no se puede deducir ninguno.
    const two = parseTicket([ocr(...HEADER, ['PAN 1-29:B', '?'], ['SAL 9;9;9', '?'], 'TOTAL 2,00')])
    expect(two.lines.map((l) => [l.amountCents, l.flags])).toEqual([
      [null, ['ilegible']],
      [null, ['ilegible']],
    ])
    expect(two.check).toMatchObject({ status: 'no_cuadra', unreadable: 2 })
  })

  it('una devolución resta', () => {
    const ticket = parseTicket([ocr(...HEADER, 'LECHE ENTERA 0,89 A', 'LECHE ENTERA -0,89 A', 'PAN 1,00 A', 'TOTAL 1,00', ...FOOTER)])
    expect(ticket.lines.map((l) => l.amountCents)).toEqual([89, -89, 100])
    expect(ticket.check.status).toBe('cuadra')
  })

  it('sin total, no marca el ticket como correcto', () => {
    const ticket = parseTicket([ocr(...HEADER, 'PAN 1,00 A')])
    expect(ticket.totalCents).toBeNull()
    expect(ticket.check.status).toBe('sin_total')
  })
})

describe('otras tiendas y texto pegado', () => {
  it('lee un ticket genérico con la cantidad delante', () => {
    const text = [
      'MERCADONA, S.A.',
      'C/ EJEMPLO, 1',
      '28/10/2026 19:24  OP: 123456',
      'Descripción          P. Unit  Importe',
      '1 PAN BARRA                     0,60',
      '2 YOGUR GRIEGO           1,20   2,40',
      '1 PLATANO                       1,95',
      'TOTAL (€)                       4,95',
      'TARJETA BANCARIA                4,95',
    ].join('\n')
    const ticket = parseTicket([linesFromText(text)])
    expect(ticket).toMatchObject({ store: 'otra', storeName: 'Mercadona', date: '2026-10-28', time: '19:24', totalCents: 495 })
    expect(ticket.lines.map((l) => [l.rawName, l.quantity, l.unitPriceCents, l.amountCents])).toEqual([
      ['PAN BARRA', 1, null, 60],
      ['YOGUR GRIEGO', 2, 120, 240],
      ['PLATANO', 1, null, 195],
    ])
    expect(ticket.check.status).toBe('cuadra')
  })
})

describe('mergePages', () => {
  it('quita las líneas repetidas al unir capturas de un ticket largo', () => {
    const first = ocr('EUR', 'PAN 1,00 A', 'LECHE 0,89 A', 'HUEVOS 2,10 A')
    const second = ocr('LECHE 0,89 A', 'HUEVOS 2,10 A', 'SAL 0,40 A', 'TOTAL 4,39')
    expect(mergePages([first, second]).map((l) => l.text)).toEqual(['EUR', 'PAN 1,00 A', 'LECHE 0,89 A', 'HUEVOS 2,10 A', 'SAL 0,40 A', 'TOTAL 4,39'])
  })

  it('no confunde un producto repetido de verdad con el solape', () => {
    const first = ocr('EUR', 'FIDEOS 0,65 B')
    const second = ocr('FIDEOS 0,65 B', 'TOTAL 1,30')
    expect(mergePages([first, second])).toHaveLength(4)
  })
})

describe('checkTicket', () => {
  it('recalcula la suma tras corregir importes en la revisión', () => {
    expect(checkTicket([{ amountCents: 100, discountCents: 10 }, { amountCents: 50, discountCents: 0 }], 140)).toEqual({
      status: 'cuadra',
      linesTotalCents: 140,
      differenceCents: 0,
      unreadable: 0,
    })
    expect(checkTicket([{ amountCents: null, discountCents: 0 }], 140)).toMatchObject({ status: 'no_cuadra', unreadable: 1 })
  })
})

describe('textos de los tickets', () => {
  it('normaliza nombres y los compara aunque el OCR se equivoque en alguna letra', () => {
    expect(nameKey('Jamón serrano reser.')).toBe('JAMON SERRANO RESER')
    expect(nameKey('LASAÑA  BOLOÑESA')).toBe('LASANA BOLONESA')
    expect(similarity('FTLETE DE PECHUGA', 'FILETE DE PECHUGA')).toBeGreaterThan(0.85)
    expect(similarity('PIZZA BARBACOA', 'PIZZA JAMON Y QUESO')).toBeLessThan(0.6)
    expect(similarity('LECHE', 'LECHE')).toBe(1)
  })

  it('pone bonito el nombre de un producto nuevo y supone su frecuencia', () => {
    expect(prettyName('PAN DE MOLDE INTEGRA')).toBe('Pan de molde integra')
    expect(prettyName('PLÁTANO  CANARIO')).toBe('Plátano canario')
    expect(prettyName('HUEVOS CAMPEROS L')).toBe('Huevos camperos L')
    expect(prettyName('CAMISETA XL')).toBe('Camiseta XL')
    expect(prettyName('PAN Y LECHE A GRANEL')).toBe('Pan y leche a granel')
    expect(guessFrequency('PAPEL HIGIÉNICO 12R')).toBe('mensual')
    expect(guessFrequency('ACEITE DE OLIVA V.E.')).toBe('mensual')
    expect(guessFrequency('PECHUGA DE POLLO')).toBe('semanal')
  })
})
