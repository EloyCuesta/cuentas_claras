
/** Limpieza de líneas: letras que parecen cifras, separadores y líneas que no son productos. */

/** Letras que el OCR pone en lugar de cifras. Solo se cambian dentro de algo con forma de importe. */
const DIGIT_LOOKALIKES: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', S: '5', B: '8', Z: '2' }
/**
 * Un importe con letras parecidas a cifras: «5,O8», «I,29», «3,79B». La segunda
 * cifra decimal nunca puede ser una B: «3,7B» es «3,7» seguido de la letra del
 * IVA (mal leído) y no 3,78; ni una «l» minúscula: «1,5l» es litro y medio.
 * Exige al menos una cifra de verdad, para no tocar palabras.
 */
const LOOKALIKE_AMOUNT = /(?<![\p{L}\d])([0-9OoIlSZB]{1,4})([,.:;])([0-9OoIlSZB])([0-9OoISZ])(?=[xX×*]|[ABC]?(?![\p{L}\d]))/gu

function replaceLookalikes(text: string): { text: string; replaced: boolean } {
  let replaced = false
  const result = text.replace(LOOKALIKE_AMOUNT, (match, integer: string, separator: string, d1: string, d2: string) => {
    if (!/\d/.test(integer + d1 + d2)) return match
    const fixed = (integer + d1 + d2).replace(/[OoIlSZB]/g, c => DIGIT_LOOKALIKES[c])
    if (fixed !== integer + d1 + d2) replaced = true
    return `${fixed.slice(0, integer.length)}${separator}${fixed.slice(integer.length)}`
  })
  return { text: result, replaced }
}

/** Arregla lo que el OCR separa o ensucia: «0, 99x» → «0,99x», «2 ,84X» → «2,84X», rayas y subrayados → espacio. */
export function cleanText(text: string): string {
  const spaced = text
    .replace(/[−–](?=\s*\d)/g, '-')
    .replace(/[—–_|]+/g, ' ')
    .replace(/(\d)\s*([,.:;])\s+(?=\d)/g, '$1$2')
    .replace(/(\d)\s+([,.])(?=\d{2}(?:\b|[xX×]))/g, '$1$2')
    // «2,84x2» → «2,84x 2»: la cantidad pegada al multiplicador.
    .replace(/(\d[,.:;]\d{2}\s*[xX×*]{1,2})(?=\d{1,3}(?!\d|[,.:;]\d))/g, '$1 ')
  return replaceLookalikes(spaced).text.replace(/\s+$/g, '')
}

export const hasLookalikeDigits = (text: string) => replaceLookalikes(text.replace(/(\d)\s*([,.:;])\s+(?=\S)/g, '$1$2')).replaced

export const tokensOf = (text: string) => text.trim().split(/\s+/).filter(Boolean)
export const letterCount = (text: string) => (text.match(/\p{L}/gu) ?? []).length

/** Donde empieza el primer hueco grande (3 o más espacios): separa la columna del nombre de la de los importes. */
export function firstGapTokenIndex(text: string): number | null {
  const gap = /\S(\s{3,})\S/.exec(text)
  if (!gap) return null
  return tokensOf(text.slice(0, gap.index + 1)).length
}

export const isSeparator = (text: string) => /^[\s\-=*_.·•]*$/.test(text)
export const WEIGHT_LINE = /(\d{1,3})\s?[,.]\s?(\d{3})\s*kg\b.*?[xX×*]\s*(\d{1,4})\s?[,.:;]\s?(\d{2})/i
export const DISCOUNT_LINE = /^\s*(desc\b|desc\.|desc,|dto\b|descuento|promo\b|cup[oó]n|ahorro)/i
export const TOTAL_LINE = /^\s*TOTAL\b(?!\s*(oferta|desc|ahorro))/i
export const HEADER_WORDS = /^\s*(descripci[oó]n|cantidad|p\.?\s*unit|precio|importe|eur)\b/i

export const PAYMENT_LINE = /^\s*(Lidl\s*Pay|tarjeta|efectivo|cambio|pagado|pago\b|m[eé]todo de pago|comercio:|num\.?\s*operaci[oó]n|FECHA:|HORA:|CAJA:|IMPORTE:)/i
export const FISCAL_LINE = /^\s*(IVA\b|I\.?V\.?A\.?\s|TIPO\s+IVA|BASE\s+IMP|CUOTA\b|[ABC]\s+\d{1,2}[,.]?\d*\s*%)/i
export const PROMOTIONAL_LINE = /^\s*(ofertas?\b|puntos?\b|recompensas?\b|gracias\b|atenci[oó]n\b|compra realizada|pr[oó]xima compra|v[aá]lido|www\.|tel[eé]fono|ahorro\s+total|total\s+(ahorro|desc|oferta)|has ahorrado)/i
export const endsProducts = (text: string) => PAYMENT_LINE.test(text) || FISCAL_LINE.test(text) || PROMOTIONAL_LINE.test(text)
