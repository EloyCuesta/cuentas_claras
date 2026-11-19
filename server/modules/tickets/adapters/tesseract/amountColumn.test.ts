import { describe, expect, it } from 'vitest'
import { amountBand, type LineBox } from './amountColumn.ts'

/** Una línea de ticket de 42 columnas: cada palabra en su columna, con letras de 20 px de ancho y el texto desde x = 40. */
function line(text: string): LineBox {
  const words: LineBox['words'][number][] = []
  for (const match of text.matchAll(/\S+/g)) words.push({ text: match[0], x0: 40 + match.index * 20, x1: 40 + (match.index + match[0].length) * 20 })
  return { text, x0: words[0]?.x0 ?? 40, x1: words.at(-1)?.x1 ?? 40, words }
}

const WIDTH = 40 + 42 * 20 + 40

describe('la banda de importes', () => {
  it('empieza en la columna de las multiplicaciones y llega al borde derecho', () => {
    const band = amountBand([
      line('LECHE ENTERA         0,95x   6      5,70 A'),
      line('PAN BARRA RÚSTICA                   0,65 A'),
      line('HUEVOS M DOCENA                     2,55 A'),
      line('PIZZA PROSCIUTTO     2,55x   2      5,10 B'),
    ], WIDTH)
    expect(band).toMatchObject({ right: WIDTH, charWidth: 20 })
    // La columna 21 empieza en 40 + 21 × 20 = 460; un poco antes, sin llegar al nombre (columnas 0-19).
    expect(band!.left).toBeGreaterThan(40 + 20 * 20)
    expect(band!.left).toBeLessThanOrEqual(460)
  })

  it('sirve aunque la primera pasada no haya leído los importes de muchas líneas', () => {
    const band = amountBand([
      line('PAN BARRA RÚSTICA'), line('HUEVOS M DOCENA'), line('QUESO TIERNO CUÑA'), line('YOGUR SABORES 8U'),
      line('ACEITE GIRASOL 1L                   1,89 A'), line('VINAGRE DE VINO                     0,79 B'), line('SAL FINA 1KG                        0,35 B'),
    ], WIDTH)
    expect(band!.left).toBeGreaterThan(40 + 20 * 20)
    expect(band!.left).toBeLessThanOrEqual(460)
  })

  it('los precios por kilo de las líneas de peso no cuentan como la columna de importes', () => {
    const band = amountBand([
      line('FILETE PECHUGA POLLO                4,28 B'), line('  0,612 kg x 6,99   EUR/kg'),
      line('FILETE PECHUGA POLLO                4,10 B'), line('  0,587 kg x 6,99   EUR/kg'),
      line('FILETE PECHUGA POLLO                4,42 B'), line('  0,633 kg x 6,99   EUR/kg'),
      line('  Desc.                            -0,43'),
    ], WIDTH)
    expect(band!.left).toBeGreaterThan(40 + 20 * 20)
    expect(band!.left).toBeLessThanOrEqual(460)
  })

  it('nunca entra en la columna del nombre, aunque algo parecido a una multiplicación esté dentro', () => {
    const band = amountBand([
      line('ZUMO 1,25x PACK      1,19x   2      2,38 B'),
      line('AGUA 0,50x LITRO     0,35x   6      2,10 B'),
      line('SAL FINA 1KG                        0,35 B'),
      line('LECHE ENTERA                        0,95 A'),
    ], WIDTH)
    expect(band!.left).toBeGreaterThan(40 + 20 * 20)
  })

  it('sin una columna de importes a la derecha no hay banda', () => {
    expect(amountBand([line('1,20 PAN'), line('0,95 LECHE'), line('2,55 HUEVOS'), line('TOTAL 4,70')], WIDTH)).toBeNull()
    expect(amountBand([line('PAN BARRA RÚSTICA'), line('HUEVOS M DOCENA')], WIDTH)).toBeNull()
  })
})
