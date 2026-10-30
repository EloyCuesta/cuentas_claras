import { describe, expect, it } from 'vitest'
import { centsToInput, formatAmount, formatCompactEuros, formatEuros, parseAmount, sumCents } from './money.ts'

const cents = (input: string) => {
  const result = parseAmount(input)
  return result.ok ? result.cents : result.error
}

describe('parseAmount', () => {
  it.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12,50', 1250],
    ['12.50', 1250],
    ['12.5', 1250],
    ['0,01', 1],
    [',5', 50],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['1.500', 150000],
    ['1.234.567,89', 123456789],
    ['  45,90 € ', 4590],
    ['007,10', 710],
  ])('convierte «%s» en %i céntimos', (input, expected) => {
    expect(cents(input)).toBe(expected)
  })

  it.each(['', 'abc', '12a', '-5', '0', '0,00', '12,345', '1,2,3', '12.3456', '1.23.4', '1234567890'])(
    'rechaza «%s»',
    (input) => {
      expect(parseAmount(input).ok).toBe(false)
    },
  )

  it('suma céntimos sin errores de redondeo', () => {
    // En coma flotante 0.1 + 0.2 = 0.30000000000000004
    expect(sumCents([cents('0,10') as number, cents('0,20') as number])).toBe(30)
  })
})

describe('formatEuros', () => {
  const normalize = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ')

  it('usa formato español con separador de miles', () => {
    expect(normalize(formatEuros(123456))).toBe('1.234,56 €')
    expect(normalize(formatEuros(5))).toBe('0,05 €')
    expect(normalize(formatEuros(123456789))).toBe('1.234.567,89 €')
  })

  it('usa el signo menos tipográfico y el más opcional', () => {
    expect(normalize(formatEuros(-500))).toBe('\u22125,00 €')
    expect(normalize(formatEuros(500, 'always'))).toBe('+5,00 €')
    expect(normalize(formatEuros(0, 'always'))).toBe('0,00 €')
  })
})

describe('formatos para tablas y gráficos', () => {
  const normalize = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ')

  it('escribe importes sin símbolo y abreviados', () => {
    expect(formatAmount(123456)).toBe('1.234,56')
    expect(formatAmount(-500)).toBe('\u22125,00')
    expect(normalize(formatCompactEuros(150000))).toBe('1,5 mil €')
    expect(normalize(formatCompactEuros(50000))).toBe('500 €')
    expect(normalize(formatCompactEuros(0))).toBe('0 €')
  })
})

describe('centsToInput', () => {
  it('genera texto editable sin separador de miles', () => {
    expect(centsToInput(123456)).toBe('1234,56')
    expect(centsToInput(5)).toBe('0,05')
    expect(centsToInput(65000)).toBe('650,00')
  })
})
