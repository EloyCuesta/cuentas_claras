/**
 * Importes en céntimos enteros.
 *
 * Nunca se suman ni restan decimales: 12,34 € se guarda como 1234. Así se evitan
 * errores de redondeo como 0.1 + 0.2 = 0.30000000000000004.
 */

/** Límite razonable para una aplicación personal: 999.999.999,99 €. */
export const MAX_CENTS = 99_999_999_999

export type AmountParseResult =
  | { ok: true; cents: number }
  | { ok: false; error: string }

const INVALID = 'Escribe un importe válido, por ejemplo 12,50.'

/** true si "1.234.567" usa el separador de miles correctamente (grupos de 3). */
function isGroupedThousands(value: string, separator: string): boolean {
  const groups = value.split(separator)
  if (groups.length === 1) return /^\d+$/.test(value)
  return /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((group) => /^\d{3}$/.test(group))
}

/**
 * Convierte lo que escribe el usuario en céntimos.
 *
 * Acepta formato español ("1.234,56", "12,5") y también punto decimal
 * ("12.50"), habitual en algunos teclados de móvil. Un punto seguido de
 * exactamente tres cifras se interpreta como separador de miles ("1.500" = 1500 €).
 */
export function parseAmount(input: string): AmountParseResult {
  const raw = input.replace(/[\s\u00a0\u202f€]/g, '')
  if (raw === '') return { ok: false, error: 'Escribe el importe.' }
  if (raw.startsWith('-') || raw.startsWith('\u2212')) {
    return { ok: false, error: 'Escribe el importe sin signo. El tipo indica si es gasto o ingreso.' }
  }
  if (!/^[\d.,]+$/.test(raw)) return { ok: false, error: INVALID }

  let integerPart: string
  let decimalPart = ''
  const lastComma = raw.lastIndexOf(',')
  const lastDot = raw.lastIndexOf('.')

  if (lastComma !== -1 && lastDot !== -1) {
    // Hay coma y punto: el último es el separador decimal y el otro, el de miles.
    const decimalSeparator = lastComma > lastDot ? ',' : '.'
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ','
    const parts = raw.split(decimalSeparator)
    if (parts.length !== 2 || !isGroupedThousands(parts[0], thousandsSeparator)) {
      return { ok: false, error: INVALID }
    }
    integerPart = parts[0].split(thousandsSeparator).join('')
    decimalPart = parts[1]
  } else if (lastComma !== -1) {
    const parts = raw.split(',')
    if (parts.length !== 2) return { ok: false, error: 'Usa la coma solo para los decimales.' }
    integerPart = parts[0]
    decimalPart = parts[1]
  } else if (lastDot !== -1) {
    const parts = raw.split('.')
    if (parts.length === 2 && parts[1].length <= 2) {
      integerPart = parts[0]
      decimalPart = parts[1]
    } else if (isGroupedThousands(raw, '.')) {
      integerPart = parts.join('')
    } else {
      return { ok: false, error: INVALID }
    }
  } else {
    integerPart = raw
  }

  if (integerPart === '') integerPart = '0'
  if (!/^\d+$/.test(integerPart) || (decimalPart !== '' && !/^\d+$/.test(decimalPart))) {
    return { ok: false, error: INVALID }
  }
  if (decimalPart.length > 2) return { ok: false, error: 'Usa como máximo dos decimales.' }

  const integerDigits = integerPart.replace(/^0+(?=\d)/, '')
  if (integerDigits.length > 9) return { ok: false, error: 'El importe es demasiado grande.' }

  const cents = Number(integerDigits) * 100 + Number(decimalPart.padEnd(2, '0'))
  if (cents <= 0) return { ok: false, error: 'El importe tiene que ser mayor que 0.' }
  if (cents > MAX_CENTS) return { ok: false, error: 'El importe es demasiado grande.' }
  return { ok: true, cents }
}

const euroFormatter = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  // "always" agrupa también los números de cuatro cifras (1.234,56 €), como los bancos.
  useGrouping: 'always',
})

/** Signo menos tipográfico (U+2212); los lectores de pantalla lo leen como "menos". */
export const MINUS = '\u2212'

/**
 * Formatea céntimos como euros en formato español: 1.234,56 €.
 * Con sign = 'always' los positivos llevan "+".
 */
export function formatEuros(cents: number, sign: 'auto' | 'always' = 'auto'): string {
  const absolute = euroFormatter.format(Math.abs(cents) / 100)
  if (cents < 0) return `${MINUS}${absolute}`
  if (sign === 'always' && cents > 0) return `+${absolute}`
  return absolute
}

const amountFormatter = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: 'always',
})

/** Importe sin el símbolo, para tablas cuyo encabezado ya dice «€»: 123456 -> "1.234,56". */
export function formatAmount(cents: number): string {
  const absolute = amountFormatter.format(Math.abs(cents) / 100)
  return cents < 0 ? `${MINUS}${absolute}` : absolute
}

const compactFormatter = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 })

/** Importe abreviado para los ejes de los gráficos: 150000 -> "1,5 mil €". */
export function formatCompactEuros(cents: number): string {
  return `${compactFormatter.format(cents / 100)} €`
}

/** Valor para un campo de texto editable: 123456 -> "1234,56". */
export function centsToInput(cents: number): string {
  const absolute = Math.abs(cents)
  const integer = Math.floor(absolute / 100)
  const decimals = String(absolute % 100).padStart(2, '0')
  return `${cents < 0 ? '-' : ''}${integer},${decimals}`
}

export function sumCents(values: readonly number[]): number {
  let total = 0
  for (const value of values) total += value
  return total
}
