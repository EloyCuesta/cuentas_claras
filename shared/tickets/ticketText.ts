/**
 * Utilidades de texto para los tickets: normalizar nombres para emparejarlos,
 * compararlos aunque el OCR se haya equivocado en alguna letra y ponerlos
 * bonitos al crear un producto.
 */

/** Clave para emparejar líneas de ticket: mayúsculas, sin tildes ni signos. «Jamón serrano reser.» → «JAMON SERRANO RESER». */
export function nameKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

function bigrams(text: string): Map<string, number> {
  const compact = text.replace(/\s+/g, '')
  const result = new Map<string, number>()
  for (let i = 0; i < compact.length - 1; i++) {
    const pair = compact.slice(i, i + 2)
    result.set(pair, (result.get(pair) ?? 0) + 1)
  }
  return result
}

/** Distancia de edición (letras cambiadas, añadidas o quitadas). */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length]
}

/**
 * Parecido entre dos nombres (0 a 1). Tolera los errores típicos del OCR: una
 * letra cambiada («PTZZA BARBACOA», «FTLETE DE PAVO») da más de 0,9. Es el
 * mayor de dos medidas: la distancia de edición y el coeficiente de Dice sobre
 * pares de letras (mejor cuando cambia el orden de las palabras).
 */
export function similarity(a: string, b: string): number {
  const keyA = nameKey(a)
  const keyB = nameKey(b)
  if (keyA === keyB) return 1
  const compactA = keyA.replace(/\s+/g, '')
  const compactB = keyB.replace(/\s+/g, '')
  const longest = Math.max(compactA.length, compactB.length)
  const edit = longest === 0 ? 0 : 1 - editDistance(compactA, compactB) / longest
  return Math.max(edit, dice(keyA, keyB))
}

function dice(keyA: string, keyB: string): number {
  const pairsA = bigrams(keyA)
  const pairsB = bigrams(keyB)
  let sizeA = 0
  let sizeB = 0
  for (const count of pairsA.values()) sizeA += count
  for (const count of pairsB.values()) sizeB += count
  if (sizeA === 0 || sizeB === 0) return 0
  let shared = 0
  for (const [pair, count] of pairsA) shared += Math.min(count, pairsB.get(pair) ?? 0)
  return (2 * shared) / (sizeA + sizeB)
}

/** Tallas que se quedan en mayúsculas: «HUEVOS CAMPEROS L» → «Huevos camperos L» (pero «PAN Y LECHE» → «Pan y leche»). */
const SIZE_WORD = /^(?:[B-DF-NP-TV-XZ]|X{1,3}[SL])$/

/** Nombre para un producto nuevo: «PAN DE MOLDE INTEGRA» → «Pan de molde integra». */
export function prettyName(raw: string): string {
  const words = raw.replace(/\s+/g, ' ').trim().split(' ')
  const lower = words.map((word) => (SIZE_WORD.test(word) ? word : word.toLocaleLowerCase('es'))).join(' ')
  return lower.charAt(0).toLocaleUpperCase('es') + lower.slice(1)
}

/**
 * Primera suposición de cada cuánto se compra algo, por su nombre. Solo sirve
 * hasta que haya compras suficientes para calcular su ritmo de verdad.
 */
const MONTHLY_WORDS = [
  'ACEITE', 'ARROZ', 'AZUCAR', 'HARINA', 'SAL', 'CAFE', 'INFUSION', 'TE ', 'CACAO', 'PASTA', 'MACARRON', 'ESPAGUETI', 'FIDEO',
  'NOODLES', 'LEGUMBRE', 'GARBANZO', 'LENTEJA', 'ALUBIA', 'CONSERVA', 'ATUN', 'SARDINA', 'MEJILLON', 'ACEITUNA', 'PEPINILLO',
  'PIMIENTO', 'TOMATE TRITURADO', 'TOMATE FRITO', 'MELOCOTON EN', 'CALDO', 'VINAGRE', 'ESPECIA', 'PIMIENTA', 'MAYONESA', 'KETCHUP',
  'MOSTAZA', 'PAPEL', 'SERVILLETA', 'DETERGENTE', 'SUAVIZANTE', 'LEJIA', 'LAVAVAJILLAS', 'FRIEGASUELOS', 'LIMPIA', 'BAYETA',
  'ESTROPAJO', 'BOLSA BASURA', 'GEL', 'CHAMPU', 'DENTIFRICO', 'PASTA DIENTES', 'CEPILLO', 'DESODORANTE', 'COMPRESA', 'PANAL',
  'TOALLITA', 'ALGODON', 'BASTONC', 'PILAS', 'ALUMINIO', 'FILM', 'CONGELAD',
]

export function guessFrequency(raw: string): 'semanal' | 'mensual' {
  const key = ` ${nameKey(raw)} `
  return MONTHLY_WORDS.some((word) => key.includes(` ${word}`)) ? 'mensual' : 'semanal'
}
