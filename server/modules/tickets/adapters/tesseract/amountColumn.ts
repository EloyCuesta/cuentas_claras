/**
 * La banda de importes de un ticket: el rango x donde están la cantidad × el
 * precio, el importe y la letra del IVA, calculado con todas las líneas de la
 * imagen. Así se puede releer esa columna en cada línea de producto aunque
 * Tesseract no la haya devuelto en alguna (la pierde si la separa como otro
 * bloque), y la relectura nunca lee el nombre.
 *
 * En el ticket de Lidl el nombre ocupa como mucho 20 columnas de 42: la banda
 * empieza detrás, en la columna de las multiplicaciones (o en la de los
 * importes si no la hay) y llega al borde derecho. Si no se encuentra una
 * columna de importes clara, no hay banda (el lector relee como antes).
 */

export interface WordBox {
  text: string
  x0: number
  x1: number
}

export interface LineBox {
  text: string
  x0: number
  x1: number
  words: readonly WordBox[]
}

export interface Band {
  left: number
  right: number
  /** Ancho medio de una letra, en píxeles. */
  charWidth: number
}

const AMOUNT = /^-?\d{1,4}[,.:;]\d{2}[A-Za-z€]?$/
const TIMES = /\d[,.:;]\d{2,3}[xX×*%]/
/** Columnas del nombre en el ticket de Lidl: nunca entran en la banda. */
const NAME_COLUMNS = 20

const percentile = (values: readonly number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]
}

export function amountBand(lines: readonly LineBox[], width: number): Band | null {
  const amounts: WordBox[] = []
  const times: WordBox[] = []
  const letters: number[] = []
  for (const line of lines) {
    const words = line.words.filter((w) => w.text.trim() !== '')
    words.forEach((word, i) => {
      const text = word.text.trim()
      if (text.length >= 4 && /\p{L}{3}/u.test(text)) letters.push((word.x1 - word.x0) / text.length)
      if (i >= Math.max(1, words.length - 2) && AMOUNT.test(text)) amounts.push(word)
      if (i >= 1 && TIMES.test(text)) times.push(word)
    })
  }
  if (amounts.length < 3 || letters.length < 3) return null
  const charWidth = percentile(letters, 0.5)
  const amountLeft = percentile(amounts.map((w) => w.x0), 0.1)
  // Los importes tienen que formar una columna a la derecha, no estar sueltos por la línea.
  if (amountLeft < width * 0.4) return null
  const textLeft = percentile(lines.filter((l) => l.text.trim().length >= 6).map((l) => l.x0), 0.1)
  const columns = (width - 2 * textLeft) / charWidth
  const lidl = columns >= 36 && columns <= 50
  const nameEnd = lidl ? textLeft + NAME_COLUMNS * charWidth : 0
  let left = amountLeft
  if (times.length >= 2) left = Math.min(left, percentile(times.map((w) => w.x0), 0.1))
  else if (lidl) left = Math.min(left, nameEnd + charWidth)
  left = Math.max(nameEnd + charWidth * 0.3, left - charWidth * 0.6)
  return { left: Math.floor(left), right: width, charWidth }
}
