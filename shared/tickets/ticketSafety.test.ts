import { describe, expect, it } from 'vitest'
import { linesFromText, mergePages, parseTicket } from './ticketParse.ts'
import { suggestForTicket } from './ticketMatch.ts'
import { nameKey } from './ticketText.ts'
import type { OcrLine } from './types.ts'

const parse = (...lines: string[]) => parseTicket([linesFromText(['LIDL', 'EUR', ...lines].join('\n'))])
/** Detrás de la cabecera de Lidl («LIDL SUPERMERCADOS S.A.U.» y «EUR»), como en los errores medidos con tickets de Lidl Plus. */
const parseLidl = (...lines: (string | OcrLine)[]) => parseTicket([[...linesFromText('LIDL SUPERMERCADOS S.A.U.\nEUR'),
  ...lines.map(line => (typeof line === 'string' ? { text: line, reread: null } : line)), ...linesFromText('TOTAL 9,99\nFECHA: 28/10/26')]])
const UNREADABLE_TIMES = 'No se ha podido leer la cantidad o el precio unitario'

describe('regresiones de seguridad de tickets', () => {
  it('no cambia una cifra únicamente para cuadrar el total', () => {
    const t = parse('RULO DE CABRA 2,23 A', 'DATIL SIN HUESO 1,25 A', 'TOTAL 3,54')
    expect(t.lines.map(l => l.amountCents)).toEqual([223, 125])
    expect(t.check.status).toBe('no_cuadra')
    expect(t.lines[0].evidence?.issues.join(' ')).toMatch(/Con 2,29\s€, el total cuadraría: comprueba esta cifra en la imagen/)
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
  it('4a. «2,75X» es un precio unitario sin cantidad, no un importe: la línea queda marcada', () => {
    const t = parseLidl({ text: 'LASAÑA 5 QUESOS      2,75X', reread: '2,75X' })
    expect(t.lines).toHaveLength(1)
    expect(t.lines[0]).toMatchObject({ rawName: 'LASAÑA 5 QUESOS', amountCents: null, unitPriceCents: null })
    expect(t.lines[0].flags.length).toBeGreaterThan(0)
    expect(t.lines[0].evidence?.issues).toContain(UNREADABLE_TIMES)
  })
  it('4b. un importe sin coma nunca es fiable, y el que sale de cifras del nombre no se usa', () => {
    const napkins = parseLidl({ text: 'SERVILLETAS 100U', reread: '100' })
    expect(napkins.lines[0]).toMatchObject({ rawName: 'SERVILLETAS 100U', amountCents: null })
    expect(napkins.lines[0].flags).toContain('ilegible')
    const butter = parseLidl({ text: 'MANTEQUILLA 250G', reread: '2506' })
    expect(butter.lines[0]).toMatchObject({ rawName: 'MANTEQUILLA 250G', amountCents: null })
    const loose = parseLidl({ text: 'DESODORANTE SPRAY                   2525 €', reread: '2525 C' })
    expect(loose.lines[0].amountCents === null || loose.lines[0].flags.length > 0).toBe(true)
    expect(loose.lines[0].flags.length).toBeGreaterThan(0)
  })
  it('4e. una cifra sin coma solo se descarta si es un número del nombre: «149» no sale del «1» de «LECHE ENTERA 1L» y frena el voto', () => {
    // Las dos relecturas de la banda son el mismo recorte y pueden equivocarse igual («1,43» por «1,49»).
    const milk = parseLidl({ text: 'LECHE ENTERA 1L                     149 A', reread: '1,43 A', rereads: ['1,43 A'] })
    expect(milk.lines[0]).toMatchObject({ rawName: 'LECHE ENTERA 1L', amountCents: 143 })
    expect(milk.lines[0].flags).toContain('dudoso')
    expect(milk.lines[0].evidence?.issues).toContain('Las lecturas del importe no coinciden')
  })
  it('4f. una cifra sin coma descartada por estar en el nombre no deja votar ni confirma otra cifra', () => {
    // «100» puede salir de «SERVILLETAS 100U», o ser «1,00» sin la coma: no se usa, pero las relecturas («1,09») no bastan.
    const napkins = parseLidl({ text: 'SERVILLETAS 100U                    100 A', reread: '1,09 A', rereads: ['1,09 A'] })
    expect(napkins.lines[0]).toMatchObject({ rawName: 'SERVILLETAS 100U', amountCents: 109 })
    expect(napkins.lines[0].flags).toContain('dudoso')
    expect(napkins.lines[0].evidence?.issues).toContain('Las lecturas del importe no coinciden')
    // Si dice lo mismo que el importe («100» y «1,00»), no lo contradice; pero tampoco lo confirma.
    const same = parseLidl({ text: 'SERVILLETAS 100U                    100 A', reread: '1,00 A', rereads: ['1,00 A'] })
    expect(same.lines[0]).toMatchObject({ rawName: 'SERVILLETAS 100U', amountCents: 100 })
    expect(same.lines[0].flags).toContain('dudoso')
    expect(same.lines[0].evidence?.issues).not.toContain('Las lecturas del importe no coinciden')
  })
  it('4c. una multiplicación que no se puede leer marca la línea en vez de darla por 1 unidad', () => {
    const lentils = parseLidl({ text: 'LENTEJAS COCIDAS     O, 79X   2     1,58 A', reread: '79X 2 1,58 A' })
    const gel = parseLidl({ text: 'GEL DUCHA 750ML     1,1X 4    4,60 C', reread: '750 1,155X 4 4,60 C' })
    const pizza = parseLidl('PIZZA BARBACOA        2,4xX 2     4,90 B')
    for (const t of [lentils, gel, pizza]) {
      expect(t.lines).toHaveLength(1)
      expect(t.lines[0].flags.length).toBeGreaterThan(0)
      expect(t.lines[0].evidence?.issues).toContain(UNREADABLE_TIMES)
    }
    expect(lentils.lines[0]).toMatchObject({ rawName: 'LENTEJAS COCIDAS', amountCents: 158 })
    expect(gel.lines[0]).toMatchObject({ rawName: 'GEL DUCHA 750ML', amountCents: 460 })
  })
  it('4d. una línea de peso que no se lee marca el producto de encima y no crea otro', () => {
    const t = parseLidl('MANZANA GOLDEN 2,21 A', '34 kg     JO ER /La')
    expect(t.lines.map(l => l.rawName)).toEqual(['MANZANA GOLDEN'])
    expect(t.lines[0].flags.length).toBeGreaterThan(0)
    expect(t.lines[0].evidence?.issues).toContain('No se ha podido leer la línea del peso: confirma el peso, el precio por kilo y el importe')
  })
  it('sin «EUR» y sin la columna de importes, los productos entran sin importe y marcados, no se quedan en la cabecera', () => {
    const t = parseTicket([linesFromText(['Copia', 'LIDL SUPERMERCADOS S.A.U.', 'Avda. del Ensayo s/n', '39300Torrelavega',
      'PAN BARRA RÚSTICA', 'HUEVOS M DOCENA', 'LECHE ENTERA 0,95 A', 'TOTAL 4,15', 'FECHA: 03/11/26'].join('\n'))])
    expect(t.lines.map(l => [l.rawName, l.amountCents])).toEqual([['PAN BARRA RÚSTICA', null], ['HUEVOS M DOCENA', null], ['LECHE ENTERA', 95]])
    expect(t.lines.slice(0, 2).every(l => l.flags.includes('ilegible'))).toBe(true)
    expect(t.check.status).toBe('incompleto')
  })
  it('la PROMO sangrada justo debajo de un producto se le propone como descuento, por confirmar; sin sangrado, es un ajuste', () => {
    const box = (x0: number, y0: number, x1: number) => ({ imageIndex: 0, segmentIndex: 0, width: 900, height: 2000, box: { x0, y0, x1, y1: y0 + 26 } })
    const t = parseTicket([[...linesFromText('LIDL\nEUR'),
      { text: 'COOKIES PEPITAS CHOC                1,29 B', reread: '1,29 B', source: box(34, 100, 800) },
      { text: 'PROMO LIDL PLUS                  -0,14', reread: '-0,14', source: box(70, 148, 742) },
      { text: 'ARROZ LARGO                         1,09 A', reread: '1,09 A', source: box(34, 196, 800) },
      ...linesFromText('TOTAL 2,24\nA 4% 1,05 0,04 1,09\nB 10% 1,05 0,10 1,15')]])
    expect(t.adjustments).toEqual([])
    expect(t.lines[0]).toMatchObject({ discountCents: 14 })
    expect(t.lines[0].flags).toContain('dudoso')
    expect(t.lines[0].evidence?.issues).toContain('«PROMO LIDL PLUS» va sangrada debajo de este producto: se le propone como descuento, confírmalo')
    // El desglose de IVA ya se puede comprobar: el grupo B suma 1,29 − 0,14.
    expect(t.issues.some(issue => issue.includes('desglose de IVA'))).toBe(false)
    expect(t.check.status).toBe('pendiente')
    const pasted = parse('COOKIES PEPITAS CHOC 1,29 B', '  PROMO LIDL PLUS -0,14', 'TOTAL 1,15')
    expect(pasted.lines[0].discountCents).toBe(14)
    const general = parse('COOKIES PEPITAS CHOC 1,29 B', 'PROMO LIDL PLUS -0,14', 'TOTAL 1,15')
    expect(general.lines[0].discountCents).toBe(0)
    expect(general.adjustments).toMatchObject([{ label: 'PROMO LIDL PLUS', amountCents: -14, kind: 'promotion' }])
  })
  it('el concepto de un ajuste va sin el importe', () => {
    expect(parse('PAN 1,00 A', 'CUPON COMPRA       -0,50', 'TOTAL 0,50').adjustments).toMatchObject([{ label: 'CUPON COMPRA', originalText: 'CUPON COMPRA       -0,50' }])
  })
  it('una línea sin importe que no parece un producto va aparte, no a los productos', () => {
    const t = parse('PAN 1,00 A', 'Ticket de compra', '18:51  5G  87 %', 'LECHE 0,90 A', 'TOTAL 1,90')
    expect(t.lines.map(l => l.rawName)).toEqual(['PAN', 'LECHE'])
    expect(t.nonProducts?.map(l => l.text)).toEqual(['Ticket de compra', '18:51  5G  87 %'])
    expect(t.check.status).toBe('cuadra')
    expect(parse('PAN 1,00 A', 'TOTAL 1,00').nonProducts).toBeUndefined()
  })
  it('capturas sueltas: quita lo de la app de los bordes y la línea cortada, encuentra el solape con tolerancia y avisa si no lo hay', () => {
    const first = ['LIDL', 'EUR', 'PAN 1,00 A', 'LECHE ENTERA 0,95 A', 'HUEVOS M DOCENA 2,55 A', 'QUESO TIERNO 3,99 A', 'Inicio Ofertas Lidl Plus Tickets']
    const second = ['18:52 5G 87 %', 'Ticket de compra', 'HUEVOS M D0CENA 2,5S A', 'QUESO TIERNO 3,99 A', 'ARROZ 1,29 A', 'TOTAL 9,78']
    const t = parseTicket([linesFromText(first.join('\n')), linesFromText(second.join('\n'))])
    expect(t.lines.map(l => l.rawName)).toEqual(['PAN', 'LECHE ENTERA', 'HUEVOS M DOCENA', 'QUESO TIERNO', 'ARROZ'])
    expect(t.issues.join(' ')).not.toMatch(/solapan/)
    const apart = parseTicket([linesFromText(first.slice(0, 4).join('\n')), linesFromText(['QUESO TIERNO 3,99 A', 'TOTAL 6,93'].join('\n'))])
    expect(apart.issues).toContain('No se ha encontrado dónde se solapan las capturas 1 y 2: revisa si hay productos repetidos o que falten')
  })
  it('votación: un importe es fiable si la lectura del texto y otra coinciden y ninguna dice otra cosa', () => {
    const t = parseTicket([[...linesFromText('LIDL\nEUR'),
      { text: 'PAN BARRA RÚSTICA', reread: '0,65 A', rereads: ['0,65 A'] },
      { text: 'ARROZ REDONDO 1KG                   1,22 A', reread: '1,22 A', rereads: ['1,29 A'] },
      { text: 'ZANAHORIA BOLSA                     0,739 A', reread: '0,73 A', rereads: ['0,73 A'] },
      { text: 'QUESO FUNDIDO BURGER                1,25 A', reread: '1,25 A', rereads: ['1,25 A'], confidence: 60 },
      ...linesFromText('TOTAL 3,85')]])
    const [bread, rice, carrot, cheese] = t.lines
    // Sin la lectura del texto, las dos de la banda (el mismo recorte a dos escalas) no votan.
    expect(bread).toMatchObject({ amountCents: 65, flags: ['dudoso'] })
    expect(bread.evidence?.issues).toContain('El importe solo se lee en la relectura de cifras')
    expect(rice.flags).toContain('dudoso')
    expect(rice.evidence?.issues).toContain('Las lecturas del importe no coinciden')
    expect(rice.evidence?.options?.map(o => o.cents).sort()).toEqual([122, 129])
    expect(carrot.flags).toContain('dudoso')
    // Tres lecturas iguales y limpias: la poca confianza de Tesseract en la línea ya no la marca.
    expect(cheese).toMatchObject({ amountCents: 125, flags: [] })
  })
  it('4g. tres lecturas iguales y equivocadas: si el desglose de IVA no cuadra, se marca la línea que una cifra confundida explicaría', () => {
    // «ZANAHORIA BOLSA» de grande/completa-400 en el banco: 0,73 en el texto, en la banda y en la banda a 1,5×, y era 0,79.
    const read = (text: string, amount: string): OcrLine => ({ text: `${text.padEnd(36)}${amount} A`, reread: `${amount} A`, rereads: [`${amount} A`] })
    const t = parseTicket([[...linesFromText('LIDL SUPERMERCADOS S.A.U.\nEUR'),
      read('PAN DE MOLDE', '1,59'), read('ZANAHORIA BOLSA', '0,73'), read('LECHE ENTERA', '0,95'),
      ...linesFromText('TOTAL 3,33\nA 10% 3,03 0,30 3,33\nFECHA: 28/10/26')]])
    expect(t.lines.map(l => [l.rawName, l.amountCents, l.flags])).toEqual([
      ['PAN DE MOLDE', 159, []], ['ZANAHORIA BOLSA', 73, ['dudoso']], ['LECHE ENTERA', 95, []]])
    expect(t.lines[1].evidence?.issues.join(' ')).toMatch(/Con 0,79\s€, el desglose de IVA A cuadraría: comprueba esta cifra en la imagen/)
    expect(t.check).toMatchObject({ status: 'no_cuadra', differenceCents: 6, pending: 1 })
    // Sin cifra que lo explique (una diferencia de 0,04 no sale de cambiar una cifra confundible), no se marca nada más.
    const none = parseTicket([[...linesFromText('LIDL SUPERMERCADOS S.A.U.\nEUR'),
      read('PAN DE MOLDE', '1,59'), read('LECHE ENTERA', '0,95'), ...linesFromText('TOTAL 2,58\nFECHA: 28/10/26')]])
    expect(none.lines.every(l => l.flags.length === 0)).toBe(true)
    // La que comprueba la multiplicación no se marca aunque una cifra la explicara.
    const product = parseTicket([[...linesFromText('LIDL SUPERMERCADOS S.A.U.\nEUR'),
      { text: 'LECHE ENTERA 0,93x 6                5,58 A', reread: '0,93x 6 5,58 A', rereads: ['0,93x 6 5,58 A'] },
      ...linesFromText('TOTAL 5,64\nFECHA: 28/10/26')]])
    expect(product.lines[0].flags).toEqual([])
  })
  it('fuera de Lidl, una línea sin importe se queda como producto y toma el importe de la de debajo', () => {
    const t = parseTicket([linesFromText('FRUTERIA EJEMPLO\nLeche entera 0,95\nPan de pueblo\n1,20\nTOTAL 2,15')])
    expect(t.store).toBe('otra')
    expect(t.lines.map(l => [l.rawName, l.amountCents])).toEqual([['Leche entera', 95], ['Pan de pueblo', 120]])
    expect(t.nonProducts).toBeUndefined()
  })
  it('la cabecera de Lidl también acaba en una línea «… S.A.U.»: lo de después son productos', () => {
    const t = parseTicket([linesFromText(['Copia', 'LIDL', 'DISTRIBUCION S.A.U.', 'PAN BARRA RÚSTICA', 'LECHE ENTERA 0,95 A', 'TOTAL 1,60', 'FECHA: 03/11/26'].join('\n'))])
    expect(t.lines.map(l => [l.rawName, l.amountCents])).toEqual([['PAN BARRA RÚSTICA', null], ['LECHE ENTERA', 95]])
  })
  it('una línea con la fecha no es la hora de la barra de estado del móvil', () => {
    const t = parseTicket([linesFromText('LIDL\nEUR\nPAN 1,00 A\nTOTAL 1,00\n28.10.2026 14:32')])
    expect(t).toMatchObject({ date: '2026-10-28', time: '14:32' })
  })
  it('«5 KG PATATAS 2,99 B» es un producto, no una línea de peso ni 5 unidades', () => {
    const t = parse('5 KG PATATAS 2,99 B', '2 L AGUA 0,60 A', 'TOTAL 3,59')
    expect(t.lines.map(l => [l.rawName, l.quantity, l.amountCents])).toEqual([['5 KG PATATAS', 1, 299], ['2 L AGUA', 1, 60]])
    expect(t.issues).not.toContain('Línea de peso sin producto identificable')
    // Una línea de peso que no se lee entera sigue siendo del producto de encima.
    expect(parse('PLATANO 1,23 A', '34 kg     JO ER /La', 'TOTAL 1,23').lines).toHaveLength(1)
  })
  it('un «-» pegado detrás del importe no lo confirma, aunque la relectura coincida', () => {
    const t = parseTicket([[...linesFromText('LIDL\nEUR'),
      { text: 'AGUA 1,15-', reread: null }, { text: 'LECHE 0,89-', reread: '0,89 A' },
      ...linesFromText('TOTAL 2,04')]])
    expect(t.lines.map(l => l.amountCents)).toEqual([115, 89])
    expect(t.lines.every(l => l.flags.includes('dudoso'))).toBe(true)
    expect(t.lines[0].evidence?.issues).toContain('Una lectura del importe tiene un «-» pegado detrás («1,15-»): confirma el importe')
    expect(t.lines[1].evidence?.issues).toContain('Una lectura del importe tiene un «-» pegado detrás («0,89-»): confirma el importe')
  })
})
