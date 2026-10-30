import { describe, expect, it } from 'vitest'
import { imageQuality } from '../../src/pantry/ticketImages.ts'
import { canApplyLine } from './arithmetic.ts'
import browserStrip from './fixtures/ocr-real/ejemplo-franja-navegador.json'
import lowRes from './fixtures/ocr-real/torrelavega-400px.json'
import photoEnhanced from './fixtures/ocr-real/torrelavega-foto-1600-mejorada.json'
import photo from './fixtures/ocr-real/torrelavega-foto-800.json'
import exampleTruth from './fixtures/ticket-lidl-ejemplo.json'
import torrelavegaTruth from './fixtures/ticket-torrelavega-sintetico.json'
import { checkTaxGroups, linesFromText, mergePages, parseTicket, readTaxGroups, type ParsedTicketLine } from './parse.ts'
import type { OcrLine, TicketSaveLine } from './types.ts'

/**
 * Los 14 casos de prueba del encargo «Corregir y perfeccionar el lector de
 * tickets». Procedencia de los datos, para no confundir pruebas:
 * - Líneas literales del ticket de Lidl de Torrelavega (28/10/26) que aportó el
 *   usuario, y los errores de OCR que describió. No hay imagen de ese ticket en
 *   el repositorio: la prueba con la captura original de Lidl Plus está PENDIENTE.
 * - fixtures/ocr-real/*.json: lo que leyó de verdad Tesseract de imágenes
 *   SINTÉTICAS (dibujadas imitando un ticket de Lidl). Son errores reales de OCR,
 *   pero no de una foto real.
 * - El resto, texto sintético escrito para cada caso.
 */

const lidl = (...rows: (string | [string, string])[]): OcrLine[] => [
  ...linesFromText('LIDL SUPERMERCADOS S.A.U.\nEUR'),
  ...rows.map(r => typeof r === 'string' ? { text: r, reread: null } : { text: r[0], reread: r[1] }),
]
const FOOTER = ['Lidl Pay 0,00', 'FECHA: 28/10/26', 'HORA: 19:24:38']
const parse = (...rows: (string | [string, string])[]) => parseTicket([lidl(...rows, ...FOOTER)])

/** Lo que se guardaría de una línea tal como la deja el lector (sin que nadie la confirme). */
const asSaved = (line: ParsedTicketLine, confirmed = false): TicketSaveLine => ({
  rawName: line.rawName, quantity: line.quantity, unitPriceCents: line.unitPriceCents, amountCents: line.amountCents,
  discountCents: line.discountCents, weightKg: line.weightKg, pricePerKgCents: line.pricePerKgCents, taxCode: line.taxCode,
  occasional: false, confirmed, evidence: line.evidence,
})

type Truth = { totalCents: number; lines: { rawName: string; amountCents: number }[] }
const REAL_OCR: Record<string, { lines: OcrLine[]; truth: string }> = {
  'ejemplo-franja-navegador': browserStrip, 'torrelavega-400px': lowRes,
  'torrelavega-foto-800': photo, 'torrelavega-foto-1600-mejorada': photoEnhanced,
}
const TRUTHS: Record<string, Truth> = { 'ticket-lidl-ejemplo.json': exampleTruth, 'ticket-torrelavega-sintetico.json': torrelavegaTruth }
const realOcr = (name: string) => {
  const fixture = REAL_OCR[name]
  return { ticket: parseTicket([fixture.lines]), truth: TRUTHS[fixture.truth] }
}

describe('1. Productos con multiplicadores', () => {
  it.each([
    ['BURGER CERDO Y VACU. 3,95x 2 7,90 B', 'BURGER CERDO Y VACU.', 395, 2, 790, 'B'],
    ['HUEVOS MEDIANOS M   2,84X 2 5,68 A', 'HUEVOS MEDIANOS M', 284, 2, 568, 'A'],
    ['PATATA NUEVA 5 KG   4,95X 2 9,90 A', 'PATATA NUEVA 5 KG', 495, 2, 990, 'A'],
    ['LASAÑA 5 QUESOS 2,75 × 2 5,50 B', 'LASAÑA 5 QUESOS', 275, 2, 550, 'B'],
    ['BURGER 3,95 * 2 7,90 B', 'BURGER', 395, 2, 790, 'B'],
    ['BURGER 3,95Xx 2 7,90 B', 'BURGER', 395, 2, 790, 'B'],
    ['PATATA NUEVA 5 KG 4,95x2 9,90 A', 'PATATA NUEVA 5 KG', 495, 2, 990, 'A'],
  ])('%s', (text, name, unit, quantity, amount, tax) => {
    const line = parse(text).lines[0]
    // «5 KG» y «5 QUESOS» son parte del nombre, no la cantidad.
    expect(line).toMatchObject({ rawName: name, unitPriceCents: unit, quantity, amountCents: amount, taxCode: tax, flags: [] })
  })
})

describe('2. Productos vendidos por peso', () => {
  it('peso × precio por kilo, redondeado en céntimos enteros', () => {
    const t = parse('LOMO ADOBADO 3,67 B', '0,544 kg x 6,75 EUR/kg', 'FILETE DE PECHUGA 4,15 B', '0,547 kg x 7,58 EUR/kg', 'TOTAL 7,82')
    expect(t.lines.map(l => [l.rawName, l.weightKg, l.pricePerKgCents, l.amountCents, l.flags])).toEqual([
      ['LOMO ADOBADO', 0.544, 675, 367, []], ['FILETE DE PECHUGA', 0.547, 758, 415, []]])
    expect(t.check.status).toBe('cuadra')
  })
  it('un importe de peso con dos cifras intercambiadas se propone corregido, sin confirmar', () => {
    const line = parse('LOMO ADOBADO 3,76 B', '0,544 kg x 6,75 EUR/kg', 'TOTAL 3,67').lines[0]
    expect(line).toMatchObject({ amountCents: 367, flags: ['corregido', 'dudoso'], evidence: { recognizedCents: 376, calculatedCents: 367, discrepancy: { kind: 'weight', verdict: 'calculation' } } })
    expect(canApplyLine(asSaved(line))).toBe(false)
  })
})

describe('3. Errores de dígitos adicionales: «9,90» → «92,90»', () => {
  const t = parse('PATATA NUEVA 5 KG   4,95X   2   92,90 A', 'TOTAL 9,90')
  const line = t.lines[0]
  it('detecta la incoherencia y ofrece 9,90 € como importe calculado', () => {
    expect(line).toMatchObject({ rawName: 'PATATA NUEVA 5 KG', quantity: 2, unitPriceCents: 495, amountCents: 990, taxCode: 'A' })
    expect(line.evidence).toMatchObject({ recognizedCents: 9290, calculatedCents: 990, selectedBy: 'calculation',
      discrepancy: { verdict: 'calculation', recognizedCents: 9290, calculatedCents: 990 },
      options: [{ cents: 990, origin: 'calculation' }, { cents: 9290, origin: 'read' }] })
  })
  it('no oculta la discrepancia original', () => {
    expect(line.flags).toEqual(['corregido', 'dudoso'])
    expect(line.evidence!.text).toBe('PATATA NUEVA 5 KG   4,95X   2   92,90 A')
    expect(line.evidence!.issues[0]).toMatch(/92,90.*9,90/)
  })
  it('no contamina la despensa: sin confirmar no se aplica; nunca se guarda 92,90', () => {
    expect(line.amountCents).not.toBe(9290)
    expect(canApplyLine(asSaved(line))).toBe(false)
    expect(canApplyLine(asSaved(line, true))).toBe(true)
  })
  it('cuadra la suma, pero queda «pendiente de confirmar» y no «cuadra»', () => {
    expect(t.check).toMatchObject({ status: 'pendiente', differenceCents: 0, pending: 1 })
  })
  it('la misma regla con otras cifras: «7,920» y «5,08» con una segunda lectura que da 5,68', () => {
    const other = parse('BURGER CERDO Y VACU. 3,95Xx 2 7,920 B', ['HUEVOS MEDIANOS M   2 ,84X 2 5,08 A', '2,84X 2 5,68 A'], 'TOTAL 13,58')
    expect(other.lines.map(l => [l.amountCents, l.evidence?.discrepancy?.verdict])).toEqual([[790, 'calculation'], [568, 'calculation']])
  })
  it('si el precio unitario también es dudoso, no inventa: «5,08» con «2,84 × 2» y nada más queda sin importe', () => {
    const doubtful = parse('HUEVOS MEDIANOS M   2 ,84X 2 5,08 A', 'TOTAL 5,68')
    expect(doubtful.lines[0]).toMatchObject({ amountCents: null, unitPriceCents: 284, quantity: 2, evidence: { discrepancy: { verdict: 'ambiguous' } } })
    expect(doubtful.check.status).toBe('incompleto')
  })
})

describe('4. Caracteres confundidos: «3,79B» → «3,73 5»', () => {
  it('con la lectura normal limpia, la relectura de cifras no la sustituye, pero las dos quedan a mano', () => {
    const line = parse(['PECHUGA DE POLLO 3,79B', '3,73 5'], 'TOTAL 3,79').lines[0]
    expect(line).toMatchObject({ amountCents: 379, taxCode: 'B', flags: ['dudoso'],
      evidence: { options: [{ cents: 379, origin: 'read' }, { cents: 373, origin: 'reread' }] } })
  })
  it('si solo está «3,73 5», la letra del IVA leída como cifra marca la línea', () => {
    const line = parse('PECHUGA DE POLLO 3,73 5', 'TOTAL 3,73').lines[0]
    expect(line).toMatchObject({ amountCents: 373, taxCode: 'B', flags: ['dudoso'] })
    expect(line.evidence!.issues[0]).toContain('cifra «5»')
  })
  it('letras en un importe solo se cambian dentro del importe, y la B final es el IVA, no un 8', () => {
    const t = parse('PAN 1,O9 A', 'SAL I,29 B', 'LECHE 3,79B', 'AGUA 1,5l 0,45 A', 'BOLSA 3,7B', 'TOTAL 0,00')
    expect(t.lines.map(l => [l.rawName, l.amountCents, l.taxCode])).toEqual([
      ['PAN', 109, 'A'], ['SAL', 129, 'B'], ['LECHE', 379, 'B'], ['AGUA 1,5l', 45, 'A'], ['BOLSA', null, null]])
    expect(t.lines[0].evidence!.issues).toContain('Se han interpretado letras como cifras')
    expect(t.lines[0].evidence!.text).toBe('PAN 1,O9 A')
  })
  it('«1,798» sin letra aparte: el 8 es la B del IVA; «2,992 A» con letra: sobra una cifra', () => {
    const t = parse('CHOCO SHELLS 1,798', 'HUEVOS 2,992 A', 'TOTAL 4,78')
    expect(t.lines.map(l => [l.amountCents, l.taxCode])).toEqual([[179, 'B'], [299, 'A']])
    expect(t.lines[1].evidence!.issues).toContain('Una lectura del importe tiene cifras de más («2,992»): confirma el importe')
  })
})

describe('5. Precios parcialmente ilegibles', () => {
  it('sin multiplicación, no se inventa el importe aunque se pueda despejar del total', () => {
    const t = parse('ARROZ LARGO 1,09 A', 'COOKIES PEPITAS CHOC 1-29:B', 'TOTAL 2,38')
    expect(t.lines[1]).toMatchObject({ amountCents: null, flags: ['ilegible'] })
    expect(t.check.status).toBe('incompleto')
  })
  it('con precio × cantidad legibles, se sugiere el calculado y queda por confirmar', () => {
    const line = parse('PATATA NUEVA 5 KG 4,95X 2 9,?0 A', 'TOTAL 9,90').lines[0]
    expect(line).toMatchObject({ amountCents: 990, flags: ['deducido', 'dudoso'], evidence: { selectedBy: 'calculation', recognizedCents: null } })
    expect(canApplyLine(asSaved(line))).toBe(false)
  })
  it('una relectura sin coma que no confirma el importe marca la línea («3,72B» y «2795»)', () => {
    expect(parse(['PECHUGA DE POLLO 3,72B', '2795'], 'TOTAL 3,72').lines[0].flags).toEqual(['dudoso'])
  })
})

describe('6. Productos repetidos que son compras reales diferentes', () => {
  it('dos líneas iguales en una captura son dos compras', () => {
    const t = parse('LECHE ENTERA 0,89 A', 'LECHE ENTERA 0,89 A', 'TOTAL 1,78')
    expect(t.lines).toHaveLength(2)
    expect(t.check.status).toBe('cuadra')
  })
  it('en franjas de una misma imagen solo se quita lo que coincide en posición', () => {
    const at = (text: string, y: number, segmentIndex: number): OcrLine => ({ text, reread: null, confidence: 90,
      source: { imageIndex: 0, segmentIndex, width: 1300, height: 8000, box: { x0: 100, x1: 1200, y0: y, y1: y + 30 } } })
    // Franja 0 hasta y=4096 y franja 1 desde 3968: la línea de y=4000 sale en las dos.
    const merged = mergePages([
      [at('EUR', 100, 0), at('LECHE ENTERA 0,89 A', 3900, 0), at('LECHE ENTERA 0,89 A', 4000, 0)],
      [at('LECHE ENTERA 0,89 A', 4000, 1), at('LECHE ENTERA 0,89 A', 4100, 1), at('TOTAL 2,67', 4200, 1)],
    ])
    expect(merged.map(l => l.source!.box.y0)).toEqual([100, 3900, 4000, 4100, 4200])
  })
})

describe('7. Descuentos Lidl Plus', () => {
  it('«Desc.» debajo de un artículo es su descuento; «PROMO LIDL PLUS» queda como ajuste por confirmar', () => {
    const t = parse('PECHUGA DE POLLO 5,27 B', '0,684 kg x 7,70 EUR/kg', 'Desc. -0,53', 'CAFÉ MOLIDO NATURAL 3,29 B', 'PROMO LIDL PLUS -0,33', 'TOTAL 7,70')
    expect(t.lines.map(l => [l.rawName, l.amountCents, l.discountCents])).toEqual([['PECHUGA DE POLLO', 527, 53], ['CAFÉ MOLIDO NATURAL', 329, 0]])
    expect(t.adjustments).toEqual([expect.objectContaining({ kind: 'promotion', amountCents: -33, needsReview: true })])
    expect(t.check.status).toBe('cuadra')
  })
})

describe('8. Cupones generales no asociados a un artículo', () => {
  it('un cupón no se reparte entre productos ni cambia su precio', () => {
    const t = parse('PAN 1,00 A', 'LECHE 1,00 A', 'CUPON LIDL PLUS -0,50', 'TOTAL 1,50')
    expect(t.lines.map(l => l.discountCents)).toEqual([0, 0])
    expect(t.adjustments).toEqual([expect.objectContaining({ kind: 'coupon', amountCents: -50 })])
    expect(t.check.status).toBe('cuadra')
  })
})

describe('9. Publicidad posterior al ticket', () => {
  it('las ofertas y los puntos de Lidl Plus no son compras ni cambian el total', () => {
    const t = parseTicket([lidl('PAN 1,00 A', 'TOTAL 1,00', 'Lidl Pay 1,00', 'FECHA: 28/10/26', 'Ofertas Lidl Plus', 'CHOCOLATE NEGRO 72% 1,29 B', '-20% Yogures naturales', 'Puntos Lidl Plus: 150', 'Compra realizada en', 'Torrelavega 2,00 A')])
    expect(t.lines.map(l => l.rawName)).toEqual(['PAN'])
    expect(t).toMatchObject({ totalCents: 100, paymentMethod: 'Lidl Pay', check: { status: 'cuadra' } })
  })
  it('aunque no se lea el TOTAL, la publicidad cierra la lista de productos', () => {
    const t = parseTicket([lidl('PAN 1,00 A', 'Ofertas Lidl Plus', 'CHOCOLATE 2,99 B')])
    expect(t.lines.map(l => l.rawName)).toEqual(['PAN'])
    expect(t.check.status).toBe('sin_total')
  })
})

describe('10. Tickets incompletos y muy largos', () => {
  it('sin final del ticket, avisa de que podría estar recortado', () => {
    const t = parseTicket([lidl('PAN 1,00 A', 'LECHE 0,89 A')])
    expect(t.check.status).toBe('sin_total')
    expect(t.issues).toContain('No se ha identificado el final del ticket; podría estar recortado')
  })
  it('un ticket muy largo (200 líneas) se lee entero y cuadra', () => {
    const rows = Array.from({ length: 200 }, (_, i) => `PRODUCTO ${String.fromCharCode(65 + (i % 26))}${i} 1,${String(i % 100).padStart(2, '0')} A`)
    const total = rows.reduce((sum, _, i) => sum + 100 + (i % 100), 0)
    const t = parse(...rows, `TOTAL ${Math.floor(total / 100)},${String(total % 100).padStart(2, '0')}`)
    expect(t.lines).toHaveLength(200)
    expect(t.check.status).toBe('cuadra')
  })
  it('por encima de 300 líneas deja de leer y el ticket queda «incompleto» aunque haya total', () => {
    const rows = Array.from({ length: 305 }, (_, i) => `PRODUCTO N${i} 1,00 A`)
    const t = parse(...rows, 'TOTAL 305,00')
    expect(t.lines).toHaveLength(300)
    expect(t.check.status).toBe('incompleto')
    expect(t.issues).toContain('El ticket supera las 300 líneas; lectura incompleta')
  })
})

describe('11. Devoluciones e importes negativos', () => {
  it('una devolución resta, también con multiplicación', () => {
    const t = parse('LECHE ENTERA 0,89 A', 'LECHE ENTERA -0,89 A', 'YOGUR 0,55x 2 -1,10 A', 'PAN 2,10 A', 'TOTAL 1,00')
    expect(t.lines.map(l => [l.amountCents, l.flags])).toEqual([[89, []], [-89, []], [-110, []], [210, []]])
    expect(t.check.status).toBe('cuadra')
  })
  it('una devolución nunca suma a la despensa', () => {
    const line = parse('LECHE ENTERA -0,89 A', 'TOTAL -0,89').lines[0]
    expect(canApplyLine({ ...asSaved(line), confirmed: true })).toBe(false)
  })
})

describe('12. Diferencias entre el total y la suma de productos', () => {
  it('lo dice, con la diferencia, y no toca ninguna cifra', () => {
    const t = parse('RULO DE CABRA 2,23 A', 'DATIL SIN HUESO 1,25 A', 'TOTAL 3,54')
    expect(t.check).toMatchObject({ status: 'no_cuadra', linesTotalCents: 348, differenceCents: 6 })
    expect(t.lines.map(l => [l.amountCents, l.flags])).toEqual([[223, []], [125, []]])
  })
})

describe('13. Errores compensados que hacen coincidir artificialmente el total', () => {
  it('dos lecturas dudosas que se compensan: la suma coincide, pero el estado es «pendiente»', () => {
    const t = parse(['PAN 1,00 A', '1,10 A'], ['SAL 1,00 A', '0,90 A'], 'TOTAL 2,00')
    expect(t.lines.every(l => l.flags.includes('dudoso'))).toBe(true)
    expect(t.check).toMatchObject({ status: 'pendiente', differenceCents: 0 })
  })
  it('dos errores limpios en grupos de IVA distintos: el desglose de IVA lo descubre', () => {
    // Real: PAN 1,20 A y LECHE 0,80 B. El OCR lee 1,00 y 1,00: suma 2,00 = total.
    const t = parseTicket([lidl('PAN 1,00 A', 'LECHE 1,00 B', 'TOTAL 2,00', 'Lidl Pay 2,00', 'IVA% BASE CUOTA TOTAL',
      'A 4% 1,15 0,05 1,20', 'B 10% 0,73 0,07 0,80', 'FECHA: 28/10/26')])
    expect(t.taxGroups).toEqual([expect.objectContaining({ code: 'A', grossCents: 120 }), expect.objectContaining({ code: 'B', grossCents: 80 })])
    expect(t.check.status).toBe('pendiente')
    expect(t.issues.filter(i => i.includes('desglose de IVA'))).toHaveLength(2)
    // Es solo un aviso: no corrige ninguna cifra para cuadrar.
    expect(t.lines.map(l => l.amountCents)).toEqual([100, 100])
  })
  it('un desglose que no es coherente consigo mismo no se usa', () => {
    expect(readTaxGroups(linesFromText('A 4% 1,00 0,50\nB 10% 2,00 0,20 9,99'))).toEqual([])
    expect(checkTaxGroups([{ amountCents: 100, discountCents: 0, taxCode: 'A' }], [], [])).toMatchObject({ conclusive: false, mismatches: 0 })
  })
})

describe('14. Imagen de resolución insuficiente', () => {
  it('se avisa antes de leer según los píxeles por letra', () => {
    expect(imageQuality(1080).level).toBe('buena')
    expect(imageQuality(400)).toMatchObject({ level: 'baja' })
    expect(imageQuality(280)).toMatchObject({ level: 'insuficiente' })
    expect(imageQuality(280).warning).toContain('muy poca resolución')
  })
  it('y después de leer, si muchas líneas salen con poca confianza', () => {
    const t = parseTicket([[...linesFromText('LIDL\nEUR'), ...['PAN 1,00 A', 'SAL 0,40 A', 'LECHE 0,89 A'].map(text => ({ text, reread: null, confidence: 40 })),
      ...linesFromText('TOTAL 2,29')]])
    expect(t.issues.some(i => i.includes('poca nitidez'))).toBe(true)
    expect(t.check.status).toBe('pendiente')
  })
  it('OCR real de una captura de 400 px: muchas dudas, pero ningún importe erróneo aceptado en silencio', () => {
    const { ticket, truth } = realOcr('torrelavega-400px')
    for (const line of ticket.lines) {
      const real = truth.lines.find(l => l.rawName === line.rawName)
      if (real && line.amountCents !== real.amountCents) expect(line.flags.length, line.rawName).toBeGreaterThan(0)
    }
    expect(ticket.check.status).not.toBe('cuadra')
  })
})

describe('OCR real de imágenes sintéticas (regresión)', () => {
  it.each(['ejemplo-franja-navegador', 'torrelavega-foto-800', 'torrelavega-foto-1600-mejorada'])('%s: ningún importe erróneo sin marcar, ninguna línea perdida', name => {
    const { ticket, truth } = realOcr(name)
    expect(ticket.totalCents).toBe(truth.totalCents)
    expect(ticket.lines).toHaveLength(truth.lines.length)
    truth.lines.forEach((real, i) => {
      const line = ticket.lines[i]
      if (line.amountCents !== real.amountCents) expect(line.flags.length, `${real.rawName}: ${line.amountCents} ≠ ${real.amountCents}`).toBeGreaterThan(0)
    })
  })
  it('la franja que preparaba el navegador: «2,939 A» en las dos lecturas ya no se acepta como 2,93', () => {
    const { ticket } = realOcr('ejemplo-franja-navegador')
    const potato = ticket.lines.find(l => l.rawName === 'PATATA 3 KG')!
    expect(potato.flags).toContain('dudoso')
    expect(potato.evidence!.issues.join(' ')).toContain('cifras de más')
  })
})
